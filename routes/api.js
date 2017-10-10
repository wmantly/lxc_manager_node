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

// 
var tagPrefix = settings.tagPrefix || 'clwV';

var workers = require('./worker_manager.js');



// var runnerTimeout = function(runner, time){
// 	time = time || 60000; // 1 minutes

// 	if(runner.hasOwnProperty('timeout')){
// 		clearTimeout(runner.timeout);
// 	}

// 	return runner.timeout = setTimeout(runnerFree, time, runner);
// };

// var runnerFree = function(runner){
// 	lxc.stop(runner.name, runner.worker.ip);
// 	runner.worker.usedrunners--;
// 	if(runner.hasOwnProperty('timeout')){
// 		clearTimeout(runner.timeout);
// 	}
// 	delete label2runner[runner.label];

// 	console.log(`Runner freed ${runner.label}.`, runner.worker);
// 	workers.startRunners({worker: runner.worker});
// };

// var getAvailrunner = function(runner){
// 	for(let worker of workers){
// 		if(worker.availrunners.length === 0) continue;
// 		if(runner && runner.worker.index <= worker.index) break;
// 		// if(runner) runnerFree(runner);
// 		if(runner) runner.free();

// 		return worker.getRunner();
// 	}

// 	if(runner) return runner;
// };

var run = function(req, res, runner, count){
	count = count || 0;
	console.log(`Runner starting attempt ${count}.`);

	if(!runner){
		console.log(`No runner available!`);
		res.status(503);
		return res.json({error: 'No runners, try again soon.'});
	}

	if(count > 2){
		console.log(`Runner attempt failed, to many requests!`);
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
		if(error || response.statusCode !== 200) return run(req, res, workers.getAvailableRunner(), ++count);
		body = JSON.parse(body);

		if(req.query.once){
			res.json(body);
			// 0 here does nothing
			// return runnerFree(runner, 0);
			return runner.free();
		}

		label2runner[runner.label] = runner;
		body['ip'] = runner.label;
		body['rname'] = runner.name;
		body['wname'] = runner.worker.name;
		res.json(body);

		// runnerTimeout(runner);
		runner.setTimeout();
	});
};

console.log('========STARTING===========')
setInterval(workers.checkBalance, 15000);
workers.destroyByTag();


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

	doapi.tagCreate(tagPrefix+newWorkers.version);
	workers.destroyByTag(tagPrefix+newWorkers.version);

	for(var i=0; i<newWorkers.target; i++){

		doapi.dropletToActive({
			name: 'clw'+newWorkers.version+'-'+(Math.random()*100).toString().slice(-4),
			newWorkers: newWorkers,
			image: newWorkers.image,
			size: newWorkers.size,
			onCreate: function(data, args){
				doapi.dropletSetTag(tagPrefix+args.newWorkers.version, data.droplet.id);
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
	res.send(`
		<h1>Workers</h1>
		<pre>${obj}</pre>
		<h1>label2runner</h1>
		<pre>${util.inspect(label2runner)}</pre>
		<h1>DO calls</h1>
		${doapi.calls}
	`);
});

router.get('/ping/:runner', function(req, res, next){
	var runner = label2runner[req.params.runner];
	// runnerTimeout(runner);
	runner.setTimeout();
	res.json({res:''});
});

router.post('/run/:runner?', function (req, res, next){
	console.log(`Request runner route!`);
	var runner = workers.getAvailrunner(workers.getRunner(req.params.runner));
	return run(req, res, runner);
});

module.exports = router;
