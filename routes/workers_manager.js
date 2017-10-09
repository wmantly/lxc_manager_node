'use strict';

var jsonfile = require('jsonfile');
var lxc = require('../lxc');
var doapi = require('../doapi')();
var settings = require('./workers.json');

var tagPrefix = settings.tagPrefix || 'clwV';

var workers = (function(){
	// works array constructor. This will hold the works(order by creation) and all
	// the methods interacting with the workers.
	
	// base array that will be the workers objects.
	var workers = [];

	// persistent settings object
	// .image is the currently used Digital Ocean snap shot ID
	// .lastSnapShotId is the previous ID used Digital Ocean snap shot
	// .version is the current worker version
	// .size is the base Droplet size for worker creation
	// .min is the minimum amount of workers that should exist
	// .max is the maximum amount of works that ca exist
	// .minAvail is the amount of empty workers there should be
	workers.settings = settings;

	// How many droplets are currently in the process of being created. It takes
	// about 3 minutes to create a worker.
	workers.currentCreating = 0;

	workers.create = function(){
		// manages the creation of a work from first call to all runners seeded

		// dont create more workers then the settings file allows
		if(workers.currentCreating > workers.settings.max ) return false;
		workers.currentCreating++;

		doapi.dropletToActive({
			name: 'clw'+workers.settings.version+'-'+(Math.random()*100).toString().slice(-4),
			image: workers.settings.image,
			size: workers.settings.size,
			onCreate: function(data){
				doapi.dropletSetTag(tagPrefix+workers.settings.version, data.droplet.id);
			},
			onActive: function(worker, args){
				workers.startRunners({
					worker: workers.makeWorkerObj(worker),
					onStart: function(runner, args){
						workers.push(args.worker);
						doapi.domianAddRecord({
							domain: "codeland.us",
							type: "A",
							name: "*."+worker.name+".workers",
							data: worker.publicIP
						});
						args.onStart = function(){};
					},
					onDone: function(args){
						console.log("Seeded runners on", worker.name);
						workers.currentCreating--;
					}
				});
			}
		});

	};

	workers.makeWorkerObj = function(worker){
		// Create object for each worker.

		worker.networks.v4.forEach(function(value){
			worker[value.type+'IP'] = value.ip_address;
		});

		worker.availrunners = [];
		worker.ip = worker.publicIP;
		worker.usedrunners = 0;
		worker.index = workers.length;

		worker.getRunner = function(){
			if(this.availrunners.length === 0) return false;
			// console.log('getting runner from ', worker.name, ' avail length ', this.availrunners.length);
			var runner = this.availrunners.pop();
			this.usedrunners++;
			runnerTimeout(runner);
						
			return runner;
		}

		return worker;
	};

	workers.__workersId = function(argument){
		// create array of all current worker Digital Ocean ID
		return workers.map(function(item){
			return item.id;
		});

	};

	workers.destroy = function(worker){
		// todo: If worker is passed, check for it in the workers array and
		// remove it if found.

		var worker = worker || workers.pop();
		return doapi.dropletDestroy(worker.id, function(body) {
			console.log('Deleted worker', worker.name);
		});
	};

	workers.destroyByTag = function(tag){
		// Delete works that with

		tag = tag || tagPrefix + workers.settings.version;
		let currentIDs = workers.__workersId();

		let deleteDroplets = function(droplets){
			if(droplets.length === 0) return true;
			let droplet = droplets.pop();
			if(~currentIDs.indexOf(droplet.id)) return deleteDroplets(droplets);
			
			doapi.dropletDestroy(droplet.id, function(body){
				setTimeout(deleteDroplets, 1000, droplets);
				if(!droplets.length) console.log(`Finished deleting workers tagged ${tag}.`);
			});
		}

		doapi.dropletsByTag(tag, function(data){
			data = JSON.parse(data);
			console.log(`Deleting ${data['droplets'].length} workers tagged ${tag}. Workers`,
				data['droplets'].map(function(item){
					return item.name+' | '+item.id;
				})
			);

			deleteDroplets(data['droplets']);
		});
	};

	workers.startRunners = function(args){ 
		// console.log('starting runners on', args.worker.name, args.worker.ip)

		// dont make runners on out dated workers
		if(!args.worker || workers.settings.image > args.worker.image.id){
			console.log(`Blocked outdated worker(${args.worker.image.id}), current image ${workers.settings.image}.`)
			return ;
		}

		// percent of used RAM to stop runner creation
		args.stopPercent = args.stopPercent || 80;
		args.onStart = args.onStart || function(){};
		args.onDone = args.onDone || function(){};

		ramPercentUsed(args.worker.ip, function(usedMemPercent){
			if(usedMemPercent > args.stopPercent ){
				console.log('using', String(usedMemPercent).trim(), 
					'percent memory, stopping runner creation!', args.worker.availrunners.length, 
					'created on ', args.worker.name
				);
				args.onDone(args);
				return ;
			}

			var name = 'crunner-'+(Math.random()*100).toString().slice(-4);
			// console.log('Free ram check passed!')
			lxc.startEphemeral(name, 'crunner0', args.worker.ip, function(data){
				if(!data.ip) return setTimeout(workers.startRunners, 0, args);
				// console.log('started runner on', args.worker.name)

				var runner = {
					ip: data.ip,
					name: name,
					worker: args.worker,
					label: args.worker.name + ':' + name
				};
				args.onStart(runner, args);

				args.worker.availrunners.push(runner);

				setTimeout(workers.startRunners, 0, args);
			});
		});
	};

	workers.checkForZombies = function(){
		// check to make sure all works are used or usable.
		
		let zombies = 0;

		for(let worker of workers){
			console.log(`Checking if ${worker.name} is a zombie worker.`);
			// if a runner has no available runners and no used runners, its a
			// zombie. This should happen when a newer image ID has been added
			// and old workers slowly lose there usefulness.
			if(worker.availrunners.length === 0 && worker.usedrunners === 0){
				workers.splice(workers.indexOf(worker), 1);
				console.log(`Zombie! Worker ${worker.name}, destroying.`);
				workers.destroy(worker);
				zombies++;
			}
		}

		return zombies;
	};

	workers.checkBalance = function(){
		console.log(`Checking balance.`);

		workers.checkForZombies();

		// if there are workers being created, stop scale up and down check
		if(workers.currentCreating+workers.length < workers.settings.min) null;
		else if(workers.currentCreating)
			return console.log(`Killing balance, workers are being created.`);

		// hold amount of workers with no used runners
		var lastMinAval = 0;

		// check to make sure the `workers.settings.minAvail` have free runners
		for(let worker of workers.slice(-workers.settings.minAvail)){
			if(worker.usedrunners === 0){
				lastMinAval++;
			}else{
				// no need to keep counting, workers need to be created
				break;
			}
		}

		if(lastMinAval > workers.settings.minAvail){
			// Remove workers if there are more then the settings states
			console.log(
				`Last ${workers.settings.minAvail} workers not used, killing last worker`, 
				'lastMinAval:', lastMinAval,
				'minAvail:', workers.settings.minAvail,
				'workers:', workers.length
			);

			return workers.destroy();

		} else if(lastMinAval < workers.settings.minAvail){
			// creates workers if the settings file demands it
			console.log(
				'last 3 workers have no free runners, starting worker',
				'lastMinAval:', lastMinAval,
				'minAvail:', workers.settings.minAvail,
				'workers:', workers.length
			);

			return workers.create();
		}

	};
	workers.settingsSave = function(){
		// save the live settings file to disk

		jsonfile.writeFile('./workers.json', workers.settings, {spaces: 2}, function(err) {
			console.error(err);
		});
	};

	workers.add = function(newWorkers){
		newWorkers.forEach(function(worker){
			workers.push(worker);
		});
	};

	// make sure Digital Ocean has a tag for the current worker version
	doapi.tagCreate(tagPrefix+workers.settings.version);

	return workers;

})();


module.exports = workers;