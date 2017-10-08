'use strict';

var express = require('express');
var router = express.Router();
var util = require('util');
var request = require('request');
var jsonfile = require('jsonfile');
var lxc = require('../lxc');
var doapi = require('../doapi')();
var settings = require('./workers.json');

// mapping of current used runners for quick loop up based on runner label
var label2runner = {};

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
				console.log(data)
				doapi.dropletSetTag('clwV'+workers.settings.version, data.droplet.id);
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
						console.log("done with workers");
					}
				});
				workers.currentCreating--;
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
			console.log('body of destroy', body);
		});
	};

	workers.destroyByTag = function(tag){
		// Delete works that with

		tag = tag || 'clwV' + workers.settings.version;
		var currentIDs = workers.__workersId();

		var deleteDroplets = function(droplets){
			if(droplets.length === 0) return true;
			var droplet = droplets.pop();
			if(~currentIDs.indexOf(droplet.id)) return deleteDroplets(droplets);
			
			doapi.dropletDestroy(droplet.id, function(body){
				setTimeout(deleteDroplets, 1000, droplets);
			});
		}

		doapi.dropletsByTag(tag, function(data){
			data = JSON.parse(data);
			console.log('current worker ids', currentIDs);
			console.log('do droplets', data['droplets'].length, data['droplets'].map(function(item){
				return item.name+' | '+item.id;
			}));

			deleteDroplets(data['droplets']);
		});
	};

	workers.startRunners = function(args){ 
		// console.log('starting runners on', args.worker.name, args.worker.ip)

		// dont make runners on out dated workers
		if(!args.worker || workers.settings.image > args.worker.image.id){
			console.log('blocked outdated worker', workers.settings.image, args.worker.image.id)
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
			console.log("checking", worker.name, "if zombie");
			// if a runner has no available runners and no used runners, its a
			// zombie. This should happen when a newer image ID has been added
			// and old workers slowly lose there usefulness.
			if(worker.availrunners.length === 0 && worker.usedrunners === 0){
				workers.splice(workers.indexOf(worker), 1);
				console.log('found zombie worker, destroying');
				workers.destroy(worker);
				zombie++;
			}
		}

		return zombie;
	};

	workers.checkBalance = function(){
		console.log('checking balance');

		workers.checkForZombies();

		// if there are workers being created, stop scale up and down check
		if(workers.currentCreating) return ;

		// scale up and down check

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
			console.log('Last 3 runners not used, killing last runner', workers.length);

			return workers.destroy();

		} else if(lastMinAval < workers.settings.minAvail){
			// creates workers if the settings file demands it
			console.log('last 3 workers have no free runners, starting droplet');

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
	doapi.tagCreate('clwV'+workers.settings.version);

	return workers;

})();

var ramPercentUsed = function(ip, callback){
	// checks the percent of ram used on a worker.

	return lxc.exec(
		"python3 -c \"a=`head /proc/meminfo|grep MemAvail|grep -Po '\\d+'`;t=`head /proc/meminfo|grep MemTotal|grep -Po '\\d+'`;print(round(((t-a)/t)*100, 2))\"",
		ip,
		callback
	);
};

var runnerTimeout = function(runner, time){
	time = time || 60000; // 1 minutes

	if(runner.hasOwnProperty('timeout')){
		clearTimeout(runner.timeout);
	}

	return runner.timeout = setTimeout(runnerFree, time, runner);
};

var runnerFree = function(runner){
	lxc.stop(runner.name, runner.worker.ip);
	runner.worker.usedrunners--;
	if(runner.hasOwnProperty('timeout')){
		clearTimeout(runner.timeout);
	}
	delete label2runner[runner.label];

	workers.startRunners({worker: runner.worker});
};

var getAvailrunner = function(runner){
	for(let worker of workers){
		if(worker.availrunners.length === 0) continue;
		if(runner && runner.worker.index <= worker.index) break;
		if(runner) runnerFree(runner);

		return worker.getRunner();
	}

	if(runner) return runner;
};

var run = function(req, res, runner, count){
	count = count || 0;
	console.log('run start', count);

	if(!runner){
		console.log('no runner');
		res.status(503);
		return res.json({error: 'No runners, try again soon.'});
	}

	if(count > 2){
		console.log('to many reties on runner');
		return res.status(400).json({error: 'Runner restarted to many times'});
	}

	var httpOptions = {
		url: 'http://' + runner.worker.ip,
		headers: {
			Host: runner.name
		},
		body: JSON.stringify({
			code: req.body.code
		})
	};

	return request.post(httpOptions, function(error, response, body){
		// console.log('runner response:', arguments)
		if(error || response.statusCode !== 200) return run(req, res, getAvailrunner(), ++count);
		body = JSON.parse(body);

		if(req.query.once){
			res.json(body);
			return runnerFree(runner, 0);
		}

		label2runner[runner.label] = runner;
		body['ip'] = runner.label;
		body['rname'] = runner.name;
		body['wname'] = runner.worker.name;
		res.json(body);

		runnerTimeout(runner);
	});
};

setTimeout(function(){
	// console.log('Starting balance checking in 30 seconds')
	setInterval(workers.checkBalance, 15000);
}, 600000);

workers.destroyByTag();
workers.checkBalance();


router.get('/stop/:name', function(req, res, next){
	return lxc.stop(req.params.name, function(data){
		console.log('stop', arguments);
		if(data){
			return res.json({status: 500, name: req.params.name, message: data});
		}else{
			return res.json({status: 200});
		}
	});
});
router.get('/destroyByTag', function(req, res, next) {
	workers.destroyByTag();
	res.send('?');
});

router.post('/updateID', function(req, res, next){
	var newWorkers = {
		workers: [],
		image: req.query.image,
		target: req.query.target || workers.length,
		size: req.query.size || workers.settings.size,
		version: workers.settings.version+1,
		min: req.query.min || workers.settings,
		minAvail: req.query.minAvail || workers.settings
	};

	doapi.tagCreate('clwV'+newWorkers.version);
	workers.destroyByTag('clwV'+newWorkers.version);

	for(var i=0; i<newWorkers.target; i++){

		doapi.dropletToActive({
			name: 'clw'+newWorkers.version+'-'+(Math.random()*100).toString().slice(-4),
			newWorkers: newWorkers,
			image: newWorkers.image,
			size: newWorkers.size,
			onCreate: function(data, args){
				doapi.dropletSetTag('clwV'+args.newWorkers.version, data.droplet.id);
			},
			onActive: function(droplet, args){
				workers.startRunners({
					worker: workers.makeWorkerObj(droplet),
					newWorkers: args.newWorkers,
					onStart: function(runner, args){
						args.newWorkers.workers.push(args.worker);
						console.log('onStart', args.worker.name);
						args.onStart = function(){};
					},
					onDone: function(args){
						console.log('new workers:', args.newWorkers.workers.length);
						doapi.domianAddRecord({
							domain: "codeland.us",
							type: "A",
							name: "*."+args.worker.name+".workers",
							data: args.worker.publicIP
						});
						
						if(args.newWorkers.workers.length >= args.newWorkers.target){
							console.log('upgrade complete!')
							workers.settings.image = args.newWorkers.image;
							workers.settings.size = args.newWorkers.size;
							workers.settings.min = args.newWorkers.min;
							workers.settings.minAvail = args.newWorkers.minAvail;

							workers.forEach(function(worker){
								worker.availrunners.forEach(function(runner){
									lxc.stop(runner.name, runner.worker.ip);
								});
								worker.availrunners = [];
							});

							workers.add(args.newWorkers.workers);
							workers.settingsSave();
							workers.checkBalance();
						}
					}

				});
			}
		});
	}
	res.json({status: "maybe?"});
});

router.get('/liststuff', function(req, res, next){
	var obj = util.inspect(workers, {depth: 4});
	res.send("<h1>Workers</h1><pre>"+obj+"</pre><h1>label2runner</h1><pre>"+util.inspect(label2runner)+'</pre><h1>DO calls</h1>'+doapi.calls);
});

router.get('/ping/:runner', function(req, res, next){
	var runner = label2runner[req.params.runner];
	runnerTimeout(runner);
	res.json({res:''});
});

router.post('/run/:runner?', function (req, res, next){
	console.log('hit runner route');
	var runner = getAvailrunner(label2runner[req.params.runner]);
	return run(req, res, runner);
});

module.exports = router;
