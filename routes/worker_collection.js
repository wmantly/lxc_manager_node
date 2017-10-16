'use strict';

var jsonfile = require('jsonfile');
var lxc = require('../lxc');
var doapi = require('../doapi')();
var settings = require('./workers.json');
var fs = require('fs');
settings.tagPrefix = settings.tagPrefix || 'clwV';

var utils = (function(){
	return {

		"uuid": function(){
			return (Math.random()*100).toString().slice(-4);
		}

	};

})();



var Runner = (function(){
	var proto = {};
	var __empty = function(){};

	proto.runnerMap = {};

	proto.cleanUp = function(label){
		delete proto.runnerMap[label];
	};
	
	proto.set = function(runner){
		proto.runnerMap[runner.label] = runner;
		proto.runnerMap[runner.label] = runner;
	};

	proto.get = function(label){
		return proto.runnerMap[label];
	};
	

	proto.create = function(config){
		var runner = Object.create(proto);
		Object.assign(runner, config);
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

		runner.worker.newStartRunners();
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

	return proto;
})();


var Worker = (function(){
	var proto = {};
	var __empty = function(){};
	
	// settings should probably be retrieved via a function 
	proto.settings = settings;

	proto.create = function(config){
		var worker = Object.create(proto);
		Object.assign(worker, config);
		worker.networks.v4.forEach(function(value){
			worker[ value.type + 'IP' ] = value.ip_address;
		});

		worker.availrunners = [];
		worker.ip = worker.publicIP;
		worker.usedrunners = 0;
		worker.age = +(new Date());
		worker.isBuildingRunners = false;
		worker.canSchedule = true;

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
		worker.canSchedule = false;
		return doapi.dropletDestroy(this.id, function(body) {
			console.log('Deleted worker', worker.name);
		});
	};

	proto.isZombie = function(){
		return this.availrunners.length === 0 && this.usedrunners === 0 && !this.isBuildingRunners;
	};

	proto.register = function(){
		var worker = this;
		doapi.domianAddRecord({
			domain: "codeland.us",
			type: "A",
			name: "*." + this.name + ".workers",
			data: this.publicIP
		});
	};

	proto.initialize = function(callback, config){
		// Create droplet
		// Once active the droplet begins to create runners
		doapi.dropletToActive({
			name: config.tagPrefix + (config.version+"") + '-' + utils.uuid(),
			image: config.image,
			size: config.size,
			onCreate: function(data){
				doapi.dropletSetTag(
					config.tagPrefix + config.version, 
					data.droplet.id
				);
			},
			onActive: function(data, args){
				var worker = Worker.create(data);
				worker.newStartRunners(callback);
			}
		});
	};
	proto.newStartRunners = function(args){
		// onStart is not necessary
		var worker = this;
		args.stopPercent = args.stopPercent || 80;
		args.callback = args.callback || __empty;
		args.errorCallback = args.errorCallback || __empty;

		// dont make runners on out dated workers
		if(!worker || worker.settings.image > worker.image.id || worker.isBuildingRunners){
			if(worker) {
				console.log(`
					Blocked worker(${worker.image.id}), current image ${worker.settings.image}.
					Building: ${worker.isBuildingRunners}
				`);
			}
			return;
		}

		worker.isBuildingRunners = true;
		fs.readFile(__dirname + "/../allocate_runners.sh", function(error, file){
			var command = `maxMemoryUsage=${args.stopPercent};\n${file.toString()}`;
			lxc.exec(command, worker.ip, function(data, error, stderr){
				// output chould be list of runner names
				if(error){
					// ugly
					console.log("Error", worker.ip, error);
					worker.isBuildingRunners = false;
					args.errorCallback(error, worker, args);
				} else {
					console.log("exec:");
					console.log(arguments);
					var runners = data.split(";");
					for (let idx = 0, stop = runners.length; idx < stop; idx++){

						var runner = Runner.create({
							"name": runners[idx],
							"worker": worker,
							"label": worker.name + ':' + runners[idx]
						});
						worker.availrunners.push(runner);
					}
					worker.isBuildingRunners = false;
					args.callback(worker);
				}
			});
		});
	};


	proto.startRunners = function(args){
		var worker = this;
		
		console.log('Starting runners on', worker.name, worker.ip);
		// dont make runners on out dated workers
		if(!worker || worker.settings.image > worker.image.id || worker.isBuildingRunners){
			if(worker) console.log(`Blocked worker(${worker.image.id}), current image ${worker.settings.image}. Building: ${worker.isBuildingRunners}`)
			return ;
		}
		args = args || {};
		// percent of used RAM to stop runner creation
		args.stopPercent = args.stopPercent || 80;
		args.onStart = args.onStart || __empty;
		args.onDone = args.onDone || __empty;

		worker.isBuildingRunners = true;
		
		// no longer needed
		worker.ramPercentUsed(function(usedMemPercent){
			console.log(arguments);
			if(usedMemPercent > args.stopPercent ){
				worker.isBuildingRunners = false;
				console.log('---using', String(usedMemPercent).trim(),
					'percent memory, stopping runner creation!', worker.availrunners.length, 
					'created on ', worker.name
				);
				args.onDone(worker, args);
				return ;
			} else if (usedMemPercent !== ""){
				console.log('+++using', String(usedMemPercent).trim(),
					'percent memory on ', worker.name, 
					'Runners:', worker.availrunners.length,
					`Used? ${usedMemPercent}`

				);
				var name = 'crunner-' + utils.uuid();
				// console.log('Free ram check passed!')
				lxc.startEphemeral(name, 'crunner0', worker.ip, function(data){
					setTimeout(function(){
						worker.isBuildingRunners = false;
						worker.startRunners(args);
					}, 0);

					if(data.ip){
						console.log('started runner on', worker.name);

						var runner = Runner.create({
							"ip": data.ip,
							"name": name,
							"worker": worker,
							"label": worker.name + ':' + name
						});

						args.onStart(worker, args);

						worker.availrunners.push(runner);
					}

				});
			} else {
				return setTimeout(function(){
					worker.isBuildingRunners = false;
					worker.startRunners(args);
				}, 0);
			}
		});
	};

	return proto;
})();


var WorkerCollection = (function(){
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

	// REMOVE THIS 
	workers.runnerMap = Runner.runnerMap;
	
	workers.setRunner = function(runner){
		Runner.set(runner);
	};


	workers.getRunner = function(label){
		return Runner.get(label);
	};

	//**************************************************
	//**************************************************

	workers.getAvailableRunner = function(runner){
		for(let worker of workers){
			if(worker.availrunners.length === 0) continue;
			if(runner && runner.worker.age <= worker.age) break;
			if(runner) runner.free();

			return worker.getRunner();
		}

		if(runner) return runner;
	};

	workers.create = function(config){
		// manages the creation of a work from first call to all runners seeded

		// dont create more workers then the settings file allows
		if(workers.length + workers.currentCreating >= workers.settings.max ) return false;
		workers.currentCreating++;

		var count = 0;
		config = config || workers.settings;
		Worker.initialize({
			"callback": function(worker){
				console.log("Seeded runners on", worker.name);
				workers.push(worker);
				worker.register();
				workers.currentCreating--;
			},
			"errorCallback": function(error, worker, args){
				if (count++ > 3){
					args.errorCallback = function(){};
				}
				worker.newStartRunners(args);
			}
		}, config);
	};

	workers.__workersId = function(argument){
		// create array of all current worker Digital Ocean ID
		return workers.map(function(item){
			return item.id;
		});
	};

	workers.destroy = function(worker){
		// removes last one 
		// X TODO: If worker is passed, check for it in the workers array and
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

		tag = tag || workers.settings.tagPrefix + workers.settings.version;
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

		// TODO: move to seperate method
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

			if(worker.isZombie()){
				console.log(`Zombie! Worker ${worker.name}, destroying.`);
				workers.destroy(worker);
				zombies++;
			}
		}

		return zombies;
	};

	workers.checkBalance = function(){
		console.log(`${(new Date())} Checking balance.`);

		workers.checkForZombies();

		// if there are workers being created, stop scale up and down check
		var skipBalance = workers.currentCreating + workers.length >= workers.settings.min
		if(workers.currentCreating && skipBalance){
			return console.log(`Killing balance, workers are being created.`);
		}

		// count workers and locate oldest worker
		var oldestWorker, isNotOlder, workerCount = 0;

		for(let worker of workers){
			console.log(`
				Checking worker
				worker.name: ${worker.name}
				worker.usedrunners: ${worker.usedrunners}
				worker.availrunners: ${worker.availrunners.length}
				workerCount: ${workerCount}
				compare: ${worker.usedrunners !== 0}
			`);

			if(worker.usedrunners === 0){
				workerCount++;
				isNotOlder = oldestWorker && oldestWorker.age < worker.age
				oldestWorker = (isNotOlder ? oldestWorker:worker);
			}
		}

		if(workerCount > workers.settings.minAvail){
			// Remove oldest worker if there are more than the settings file state
			console.log(`
				Destroying Worker
				Last ${workers.settings.minAvail} workers not used, killing last worker
				workerCount: ${workerCount}
				minAvail: ${workers.settings.minAvail}
				workers: ${workers.length}
			`);
			return workers.destroy(oldestWorker);

		} else if( workerCount < workers.settings.minAvail){
			// Creates worker if there are less than the settings state
			console.log(`
				Creating Worker
				last 3 workers have no free runners, starting worker,
				workerCount: ${workerCount}
				minAvail: ${workers.settings.minAvail}
				workers: ${workers.length}
			`);

			return workers.create();
		} else {
			console.log(`
				Blanced
				LMA: ${workerCount}
				Settings MA: ${workers.settings.minAvail}
				Workers: ${workers.length}
			`);
		}

	};

	workers.start = function(interval){
		setInterval(workers.checkBalance, interval || 15000);
		workers.destroyByTag();
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
	doapi.tagCreate(workers.settings.tagPrefix + workers.settings.version);

	return workers;

})();


module.exports = WorkerCollection;