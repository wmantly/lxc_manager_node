'use strict';

var express = require('express');
var router = express.Router();
var util = require('util');
var request = require('request');
var lxc = require('../lxc');
var doapi = require('../doapi')();

var workers = require('./worker_manager.js');


var attemptRun = function(req, res, runner, count){
	count = count || 0;
	console.log(`Runner starting attempt ${count}.`);

	if(!runner){
		console.log(`No runner available!`);
		res.status(503);
		return res.json({error: 'No runners, try again soon.'});
	}

	// TODO: Configurable
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
		if(error || response.statusCode !== 200) {
			return attemptRun(req, res, workers.getAvailableRunner(), ++count);
		}
		
		body = JSON.parse(body);

		if(req.query.once){
			res.json(body);
			// 0 here does nothing
			// return runnerFree(runner, 0);
			return runner.free();
		}

		workers.setRunner(runner);
		body['ip'] = runner.label;
		body['rname'] = runner.name;
		body['wname'] = runner.worker.name;
		res.json(body);

		// runnerTimeout(runner);
		runner.setTimeout();
	});
};

console.log('========STARTING===========')
// TODO: Make this a function
setInterval(workers.checkBalance, 15000);
workers.destroyByTag();

// Why is this a GET?
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

// Why is this a GET?
router.get('/destroyByTag', function(req, res, next) {
	workers.destroyByTag();
	res.send('?');
});


router.get('/liststuff', function(req, res, next){
	var obj = util.inspect(workers, {depth: 4});
	res.send(`
		<h1>Workers</h1>
		<pre>${obj}</pre>
		<h1>label2runner</h1>
		<pre>${util.inspect(workers.runnerMap)}</pre>
		<h1>DO calls</h1>
		${doapi.calls}
	`);
});

router.get('/ping/:runner', function(req, res, next){
	var runner = workers.getRunner(req.params.runner);
	// runnerTimeout(runner);
	runner.setTimeout();
	res.json({res:''});
});

router.post('/run/:runner?', function (req, res, next){
	console.log(`Request runner route!`);
	var runner = workers.getAvailrunner(workers.getRunner(req.params.runner));
	return attemptRun(req, res, runner);
});

module.exports = router;
