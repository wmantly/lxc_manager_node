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
		// TODO: Determine if this call is even needed
		// runner.worker.sync();
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

	var maxSyncAttempts = 6;

	proto.create = function(config){
		var worker = Object.create(proto);
		Object.assign(worker, config);
		worker.networks.v4.forEach(function(value){
			worker[ value.type + 'IP' ] = value.ip_address;
		});

		worker.availrunners = [];
		// need map of used runners
		// need list of all runners
		// - sync should probably populate the all runners container
		// - availrunners should the diff of used runners and all runners
		
		// runners should probably indicate when they have been used.

		worker.ip = worker.publicIP;
		worker.usedrunners = 0;
		worker.age = +(new Date());
		worker.canSchedule = true;
		worker.isBuildingRunners = false;
		worker.isSyncing = false;
		worker.syncAttempts = 0;


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


	// When should this be called
	proto.sync = function(callback, errorCallback, maxAttempts){
		var worker = this;
		
		maxAttempts = maxAttempts || maxSyncAttempts;
		worker.isSyncing = true;
		callback = callback || __empty;
		errorCallback = errorCallback || __empty;
		// this will call the droplet or the droplet will send the data using a cron job

		// mainly to update the active runners on the worker
		// potentially collect stats about the droplet as well
		// - check memory and check runners
		// - when does start runners get called?

		lxc.exec('lxc-ls --fancy', worker.ip, function(data, error, stderr){
			if (error){
				console.log("Sync Error: \n", error);
				if (worker.syncAttempts > maxAttempts){
					setTimeout(function(){
						errorCallback(error, worker);
					}, 0);
				} else {
					console.log("Waiting 15 seconds")
					worker.syncAttempts++;
					setTimeout(function(){
						worker.sync(maxAttempts, callback, errorCallback);
					}, 15000);
				}
			} else {
				
				var output = data.split("\n");
				var keys = output.splice(0,1)[0].split(/\s+/).slice(0,-1);
				var runners = [];

				keys = keys.map(function(v){return v.toLowerCase()});
				output = output.slice(0).slice(0,-1);

				for(var i in output){
					if(output[i].match(/^-/)) continue; // compatibility with 1.x and 2.x output

					var aIn = output[i].split(/\s+/).slice(0,-1);
					var mapOut = {};
					aIn.map(function(value,idx){
						mapOut[keys[idx]] = value;
					});
					runners.push(mapOut);
					
				}
				console.log(`RUNNERS FOUND[=> ${worker.ip}`);
				console.log(`RUNNERS FOUND[=>`, runners);
				// bad
				worker.availrunners = [];

				for (let idx = 0, stop = runners.length; idx < stop; idx++){
					if(runners[idx].state !== "STOPPED" && !Runner.get(worker.name + ':' + runners[idx].name)){
						var runner = Runner.create({
							"name": runners[idx].name,
							"ipv4": runners[idx].ipv4,
							"worker": worker,
							"label": worker.name + ':' + runners[idx].name
						});

						worker.availrunners.push(runner);
					}
				}
				console.log(`RUNNERS AVAILABLE[=>`, worker.availrunners);
				// TODO: Determine if this flag is needed anymore
				worker.isBuildingRunners = false;
				worker.isSyncing = false;
				worker.syncAttempts = 0;
				callback(null, worker);
			}
		});
	};

	proto.initialize = function(params, config){
		// Create droplet
		// Once active the droplet begins to create runners
		var maxMemoryUsage = args.maxMemoryUsage || config.maxMemoryUsage || 80;
		var worker_uuid = utils.uuid();
		var phone_home = config.home || "/worker/ping";


		var callback = params.callback || __empty;
		var errorCallback = params.errorCallback || empty;

		fs.readFile(__dirname + "/../allocate_runners.sh", function(error, file){

			doapi.dropletToActive({
				name: config.tagPrefix + (config.version + "") + '-' + utils.uuid(),
				image: config.image,
				size: config.size,
				user_data: proto.__buildCommand(file, maxMemoryUsage, worker_uuid, phone_home),
				
				onCreate: function(data){
					doapi.dropletSetTag(
						config.tagPrefix + config.version, 
						data.droplet.id
					);
				},
				onActive: function(data, args){
					data.worker_uuid = worker_uuid;
					var worker = Worker.create(data);
					
					// wait for boot before syncing runners
					setTimeout(function(){
						worker.sync(callback, errorCallback);
					}, 75000);
				}
			});
		});
	};

	proto.__buildCommand = function(file, maxMemoryUsage, worker_uuid, phone_home){
		var scriptSetup, script, createScript, makeScriptExecutable, setupCrontab;
		var interval = 1;
		
		// worker_uuid and phone_home are only usable with localhost tunnels setup in dev
		// cronjobSetup = `export PATH=\${PATH};export WORKER_UUID="${worker_uuid}";export PHONE_HOME=${phone_home};export maxMemoryUsage=${maxMemoryUsage};`;
		scriptSetup = `export PATH=\${PATH};export WORKER_UUID="${worker_uuid}";export maxMemoryUsage=${maxMemoryUsage};`;
		script = scriptSetup + `echo '${file.toString("base64")}'|base64 --decode|bash`;
		
		createScript = `echo "${script}" | cat > /home/virt/allocate_runners.sh`;
		
		makeScriptExecutable = `chmod o+x /home/virt/allocate_runners.sh`;
		
		setupCrontab = `echo "*/${interval} * * * * /home/virt/allocate_runners.sh > /home/virt/allocate_runners.log 2>&1" | crontab -u virt -`;
		
		return `#!/bin/bash\n\n${createScript} && ${makeScriptExecutable} && ${setupCrontab};`;
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
			"callback": function(error, worker){
				console.log("Seeded runners on", worker.name);
				workers.push(worker);
				worker.register();
				workers.currentCreating--;
			},
			"errorCallback": function(error, worker){
				// destroy worker
				workers.currentCreating--;
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

	workers.checkForZombies = function(callback){
		// check to make sure all works are used or usable.
		if (workers.length === 0) callback();
		let 
			zombies = 0, 
			syncedCount = workers.length,
			workerCleanUp = function(error, worker){
				console.log(`Zombie! Worker ${worker.name}, destroying.`);
				workers.destroy(worker);
				zombies++;
				if(!--count) callback();
			};


		for(let worker of workers){
			console.log(`Checking if ${worker.name} is a zombie worker.`);
			// if a runner has no available runners and no used runners, its a
			// zombie. This should happen when a newer image ID has been added
			// and old workers slowly lose there usefulness.
			worker.sync(function(error, worker){
				if(worker.isZombie()) workerCleanUp(error, worker);
			}, workerCleanUp);
		}
	};

	workers.checkBalance = function(){
		console.log(`${(new Date())} Checking balance.`);

		workers.checkForZombies(function(){
			// if there are workers being created, stop scale up and down check
			var skipBalance = workers.currentCreating + workers.length >= workers.settings.min;
			if(workers.currentCreating && skipBalance){
				return console.log(`Killing balance, workers are being created.`);
			}

			workers.balance();
		});
	};

	workers.balance = function(){
		console.log(`BALANCING: ${(new Date())}`);
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