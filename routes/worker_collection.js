'use strict';

var jsonfile = require('jsonfile');
var lxc = require('../lxc');
var doapi = require('../doapi')();
var settings = require('./workers.json');


var Runner = (function(){
	var proto = {};
	var __empty = function(){};
	
	proto.create = function(config){
		var runner = Object.create(proto);
		Object.assign(runner, config);
		runner.cleanUp = __empty;
		return runner;
	};

	proto.free = function(){
		var runner = this;
		lxc.stop(runner.name, runner.worker.ip);
		runner.worker.usedrunners--;
		if(runner.hasOwnProperty('timeout')){
			clearTimeout(runner.timeout);
		}

		if(runner.hasOwnProperty('cleanUp')){
			runner.cleanUp();
		}

		runner.worker.startRunners();
	};

	proto.setTimeout = function(time){
		time = time || 60000; // 1 minutes
		var runner = this;
		if(runner.hasOwnProperty('timeout')){
			clearTimeout(runner.timeout);
		}

		return runner.timeout = setTimeout(function(){
			runner.free();
		}, time);
	};

})();


var Worker = (function(){
	var proto = {};
	var __empty = function(){};
	
	// settings should probably be retrieved via a function 
	proto.settings = settings;

	proto.create = function(config){
		var worker = Object.create(proto);

		worker.networks.v4.forEach(function(value){
			worker[value.type+'IP'] = value.ip_address;
		});

		worker.availrunners = [];
		worker.ip = worker.publicIP;
		worker.usedrunners = 0;
		worker.index = workers.length;

		return worker;
	};

	proto.getRunner = function(){
		if(this.availrunners.length === 0) return false;
		// console.log('getting runner from ', worker.name, ' avail length ', this.availrunners.length);
		var runner = this.availrunners.pop();
		this.usedrunners++;
		runner.setTimeout();
					
		return runner;
	};


	proto.ramPercentUsed = function(callback){
	// checks the percent of ram used on a worker.
		return lxc.exec(
			"python3 -c \"a=`head /proc/meminfo|grep MemAvail|grep -Po '\\d+'`;t=`head /proc/meminfo|grep MemTotal|grep -Po '\\d+'`;print(round(((t-a)/t)*100, 2))\"",
			this.ip,
			callback
		);
	};

	proto.destroy = function(){
		var worker = this;
		return doapi.dropletDestroy(this.id, function(body) {
			console.log('Deleted worker', this.name);
		});
	};

	proto.startRunners = function(args){
		// console.log('starting runners on', args.worker.name, args.worker.ip)
		
		var worker = this;
		// dont make runners on out dated workers
		if(!worker || worker.settings.image > worker.image.id){
			console.log(`Blocked outdated worker(${worker.image.id}), current image ${args.settings.image}.`)
			return ;
		}

		args = args || {};
		// percent of used RAM to stop runner creation
		args.stopPercent = args.stopPercent || 80;
		args.onStart = args.onStart || __empty;
		args.onDone = args.onDone || __empty;


		worker.ramPercentUsed(function(usedMemPercent){
			if(usedMemPercent > args.stopPercent ){
				console.log('using', String(usedMemPercent).trim(),
					'percent memory, stopping runner creation!', worker.availrunners.length, 
					'created on ', worker.name
				);
				args.onDone(args);
				return ;
			}

			var name = 'crunner-'+(Math.random()*100).toString().slice(-4);
			// console.log('Free ram check passed!')
			lxc.startEphemeral(name, 'crunner0', worker.ip, function(data){
				if(!data.ip){
					return setTimeout(worker.startRunners, 0, args);
				} else {

					// console.log('started runner on', args.worker.name)

					var runner = Runner.create({
						ip: data.ip,
						name: name,
						worker: worker,
						label: worker.name + ':' + name
					});

					args.onStart(runner, args);

					worker.availrunners.push(runner);

					setTimeout(worker.startRunners, 0, args);
				}
			});
		});
	};
})();


var WorkerCollection = (function(){
	// works array constructor. This will hold the works(order by creation) and all
	// the methods interacting with the workers.
	
	// base array that will be the workers objects.
	var workers = [];

	var tagPrefix = settings.tagPrefix || 'clwV';

	workers.runnerMap = {};

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

	workers.__runnerCleanUp = function(label){
		delete workers.runnerMap[label];
	};
	
	workers.setRunner = function(runner){
		runnerMap[runner.label] = runner;
		var __empty = runner.cleanUp;
		runner.cleanUp = function(){
			workers.__runnerCleanUp(runner.label);
			runner.cleanUp = __empty;
		};
	};


	workers.getRunner = function(label){
		return runnerMap[runner.label];
	};


	workers.getAvailableRunner = function(runner){
		for(let worker of workers){
			if(worker.availrunners.length === 0) continue;
			if(runner && runner.worker.index <= worker.index) break;
			if(runner) runner.free();

			return worker.getRunner();
		}

		if(runner) return runner;
	};

	workers.create = function(config){
		// manages the creation of a work from first call to all runners seeded

		// dont create more workers then the settings file allows
		if(workers.currentCreating > workers.settings.max ) return false;
		workers.currentCreating++;

		config = config || workers.settings;

		// move this to Create Droplet function?

		doapi.dropletToActive({
			name: 'clw' + config.version + '-' + (Math.random()*100).toString().slice(-4),
			image: config.image,
			size: config.size,
			onCreate: function(data){
				doapi.dropletSetTag(
					tagPrefix + config.version, 
					data.droplet.id
				);
			},
			onActive: function(data, args){
				var worker = Worker.create(data);
				worker.startRunners({
					onStart: function(runner, args){
						workers.push(worker);
						doapi.domianAddRecord({
							domain: "codeland.us",
							type: "A",
							name: "*." + worker.name + ".workers",
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

	workers.__workersId = function(argument){
		// create array of all current worker Digital Ocean ID
		return workers.map(function(item){
			return item.id;
		});
	};

	workers.destroy = function(worker){
		// removes last one 
		// todo: If worker is passed, check for it in the workers array and
		// remove it if found.
		if ( worker ){
			var worker_idx = workers.indexOf(worker);
			if (~worker_idx){
				workers.splice(worker_idx, 1);
				return worker.destroy();
			}
		} else {
			worker = workers.pop();
			return worker.destroy();
		}
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
		if(workers.currentCreating + workers.length < workers.settings.min) {
			null;
		} else if(workers.currentCreating){
			return console.log(`Killing balance, workers are being created.`);
		}

		// hold amount of workers with no used runners
		var lastMinAval = 0;

		// check to make sure the `workers.settings.minAvail` have free runners
		for(let worker of workers.slice(-workers.settings.minAvail)){
			// INVERT this conditional
			if(worker.usedrunners !== 0){
				lastMinAval++;
			}else{
				// no need to keep counting, workers need to be created
				break;
			}
		}

		if(lastMinAval > workers.settings.minAvail){
			// Remove workers if there are more than the settings states
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
	// does this have to be last?
	// make sure Digital Ocean has a tag for the current worker version
	doapi.tagCreate(tagPrefix + workers.settings.version);

	return workers;

})();


module.exports = WorkerCollection;