'use strict';

var express = require('express');
var router = express.Router();
// what is util for??
var util = require('util');
var lxc = require('../lxc');
var doapi = require('../doapi')();

var workers = require('./worker_collection.js');

console.log('========STARTING===========');

workers.start();

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
	
	return workers.attemptRun(
		req.body.code, req.query.once, req.params.runner, 
		(body) => {
			res.json(body);
		}, 
		(error, statusCode) => {
			if (statusCode === 503){
				res.status(503);
				return res.json({error: 'No runners, try again soon.'});
			} else if (statusCode === 400){
				return res.status(400).json({error: 'Runner restarted too many times'});
			}
		}
	);
});

module.exports = router;
