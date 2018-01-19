var request = require('request');

api = function(key){
	key = key || require('./secrets.js').doAPI;
	this.BASEURL = 'https://api.digitalocean.com/v2/';
	this.headers = {
		'Content-Type': 'application/json',
		'Authorization': 'Bearer '+key
	}
	this.calls = 0;

	this.account = function(callback){
		var options = {
			url: this.BASEURL+'account',
			headers: this.headers
		};
		this.calls++;

		return request.get(options, function(error, response, body){
			return callback(body, response, error);
		});
	};

	this.dropletsByTag = function(tag, callback){
		var options = {
			url: this.BASEURL+'droplets?tag_name='+tag,
			headers: this.headers
		};
		this.calls++;
		
		return request.get(options, function(error, response, body){
			return callback(body, response, error);
		});
	};

	this.dropletSetTag = function(tag, dropletID, callback) {
		callback = callback || function(){};
		var data = {
			resources: [
				{
					resource_id: '' + dropletID,
					resource_type: 'droplet'
				}
			]
		};
		var options = {
			url: this.BASEURL+'tags/'+tag+'/resources',
			headers: this.headers,
			body: JSON.stringify(data)
		};
		this.calls++;

		return request.post(options, function(error, response, body){
			return callback(body, response, error);
		});
	};
	
	this.dropletCreate = function(args, callback){
		callback = callback || function(){};

		var data = {
			name: args.name, // || return false,
			region: args.region || 'nyc3',
			size: args.size || 's-1vcpu-1gb',
			image: args.image || 'ubuntu-14-04-x64',
			ssh_keys: args.ssh_key || null,
			backups: args.backup || false,
			private_networking: args.private_networking || true,
			user_data: args.user_data || null
		};
		var options = {
			url: this.BASEURL+'droplets',
			headers: this.headers,
			body: JSON.stringify(data)
		};
		this.calls++;

		return request.post(options, function(error, response, body){
			return callback(body, response, error);
		});
	}

	this.dropletToActive = function(args){
		args.__doapi = this; // hold the DO api in the agrs scope
		args.onCreated = args.onCreate || function(){};

		this.dropletCreate(args, function(data){
			data = JSON.parse(data);
			args.onCreate(data, args);

			// check if the server is ready, giving time to allow
			// digital ocean to do its thing
			setTimeout(function check(id, args){
				time = args.time || 10000;
				args.__doapi.dropletInfo(id, function (data){
					var droplet = JSON.parse(data)['droplet'];
					if(droplet.status == 'active'){

						return args.onActive(droplet, args);
					}else{
						 setTimeout(function(check, id){
							check(id, args);
						}, time, check, droplet.id);
					}
				});
			}, 70000, data.droplet.id, args);
		});
	};

	this.dropletDestroy = function(dropletID, callback){
		callback = callback || function(){};
		var options = {
			url: this.BASEURL+'droplets/'+dropletID,
			headers: this.headers
		};
		this.calls++;

		return request.del(options, function(error, response, body){
			callback(body, response, error);
		});
	};

	this.dropletInfo = function(dropletID, callback){
		var options = {
			url: this.BASEURL+'droplets/'+dropletID,
			headers: this.headers
		};
		this.calls++;

		return request.get(options, function(error, response, body){
			callback(body, response, error);
		});
	};

	this.tagCreate = function(tag, callback){
		callback = callback || function(){};
		var options = {
			url: this.BASEURL+'tags',
			headers: this.headers,
			body: JSON.stringify({name: tag})
		};
		this.calls++;

		return request.post(options, function(error, response, body){
			return callback(body, response, error);
		});
	};

	this.tagsList = function(callback){
		var options = {
			url: this.BASEURL+'tags',
			headers: this.headers
		};
		this.calls++;

		return request.get(options, function(e,r,b){
			callback(b,r,e);
		});
	};

	this.domianAddRecord = function(args, callback){
		callback = callback || function(){};
		var options = {
			url: this.BASEURL+'domains/'+ args.domain +'/records',
			headers: this.headers,
			body: JSON.stringify(args)
		};
		this.calls++;

		return request.post(options, function(error, response, body){
			return callback(body, response, error);
		});
	}

	return this;
}

module.exports = api;
