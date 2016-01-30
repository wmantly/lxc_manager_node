'use strict';

var express = require('express');
var router = express.Router();
var extend = require('node.extend');
var redis = require("redis");
var client = redis.createClient();
var lxc = require('../lxc');

router.get('/start/:name', function(req, res, next){
	lxc.start(req.params.name, function(data){
		console.log('start', arguments);
		if(!data){
			res.json({status: 500, name: req.params.name, message: data});
		}else{
			setTimeout(function() {
				lxc.info(req.params.name, null, function(data){
					var domain = req.query.domain || 'vm42.us';
					domain = req.params.name+'.'+domain;
					client.SADD("hosts", domain, function(){});
					
					var ip = data.ip + ':5000';
					client.HSET(domain, "ip", ip, redis.print);
					client.HSET(domain, "updated", (new Date).getTime(), redis.print);
					client.hset(domain, "include", "proxy.include");
					res.json({status: 200, info: data});
				 });
			}, 5000);

		}
	});
});

router.get('/live/:template/:name', function(req, res, next){
	lxc.startEphemeral(req.params.name, req.params.template, function (data) {
		console.log('live', arguments);
		res.json(data);
	});
});

router.get('/stop/:name', function(req, res, next){
	lxc.stop(req.params.name, function(data){
		console.log('stop', arguments);
		if(data){
			res.json({status: 500, name: req.params.name, message: data});
		}else{
			res.json({status: 200});
		}
	});
});

router.get('/clone/:template/:name', function(req, res, next){
	lxc.clone(req.params.name, req.params.template, function(data){
		console.log('clone', arguments);
		if( data.match(/Created container/) ){
			res.json({status: 200});
		}else{
			res.json({status: 500, message: data});
		}
	});
});

router.get('/destroy/:name', function(req, res, next){
	lxc.destroy(req.params.name, function(data){
		console.log('destroy', arguments);
		if(data){
			res.json({status: 500, message: data});
		}else{
			res.json({status: 200});
		}
	});
});

router.get('/info/:name', function(req, res, next){
	lxc.info(req.params.name, function(data){
		console.log('info', arguments);
		res.json(data);
	});
});

router.get('/list', function(req, res, next) {
	lxc.list(function(data){
		console.log('list', arguments);
		res.json(data);
	});
});

module.exports = router;
