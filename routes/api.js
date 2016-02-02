'use strict';

var express = require('express');
var router = express.Router();
var extend = require('node.extend');
var redis = require("redis");
var client = redis.createClient();
var request = require('request');
var lxc = require('../lxc');

var runner = function(res, req, ip){
	return request.post({url:'http://'+ip, form: req.body}, function(error, response, body){
		body = JSON.parse(body);
		body['ip'] = ip.replace('10.0.', '')
		return res.json(body)
	});
};
var addToRedis = function(){
	lxc.info(req.params.name, null, function(data){
			var domain = req.query.domain || 'vm42.us';
			domain = req.params.name+'.'+domain;
			client.SADD("hosts", domain, function(){});
			
			var ip = data.ip + ':5000';
			client.HSET(domain, "ip", ip, redis.print);
			client.HSET(domain, "updated", (new Date).getTime(), redis.print);
			client.hset(domain, "include", "proxy.include");
			return res.json({status: 200, info: data});
	 });
};

router.get('/start/:name', function(req, res, next){
	return lxc.start(req.params.name, function(data){
		console.log('start', arguments);
		if(!data){
			return res.json({status: 500, name: req.params.name, message: data});
		}else{
			res.json({})
		}
	});
});

router.get('/live/:template/:name', function(req, res, next){
	return lxc.startEphemeral(req.params.name, req.params.template, function (data) {
		console.log('live', arguments);
		return res.json(data);
	});
});

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

router.get('/clone/:template/:name', function(req, res, next){
	return lxc.clone(req.params.name, req.params.template, function(data){
		console.log('clone', arguments);
		if( data.match(/Created container/) ){
			return res.json({status: 200});
		}else{
			return res.json({status: 500, message: data});
		}
	});
});

router.get('/destroy/:name', function(req, res, next){
	return lxc.destroy(req.params.name, function(data){
		console.log('destroy', arguments);
		if(data){
			return res.json({status: 500, message: data});
		}else{
			return res.json({status: 200});
		}
	});
});

router.get('/info/:name', function(req, res, next){
	return lxc.info(req.params.name, function(data){
		return res.json(data);
	});
});

router.get('/list', function(req, res, next) {
	return lxc.list(function(data){
		return res.json(data);
	});
});

router.post('/run/:ip?', function(req, res, next){
	if(req.params.ip){
		var ip = '10.0.'+ req.params.ip;
		return runner(res, req, ip);
	}else{
		var name = 'u1-'+(Math.random()*100).toString().replace('.','');
		return lxc.startEphemeral(name, 'u1', function(data){
			return runner(res, req, data.ip);
		});
	}
});

module.exports = router;
