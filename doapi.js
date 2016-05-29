var request = require('request');

api = function(key){
	key = key || require('./secrets.js').doAPI;
	this.BASEURL = 'https://api.digitalocean.com/v2/';
	this.headers = {
		'Content-Type': 'application/json',
		'Authorization': 'Bearer '+key
	}

	this.account = function(callback){
		var options = {
			url: this.BASEURL+'account',
			headers: this.headers
		};

		return request.get(options, function(error, response, body){
			return callback(body, response, error);
		});
	};

	this.dropletsByTag = function(tag, callback){
		var options = {
			url: this.BASEURL+'droplets?tag_name='+tag,
			headers: this.headers
		};
		
		return request.get(options, function(error, response, body){
			return callback(body, response, error);
		});
	};

	this.dropletSetTag = function(tag, dropletID, callback) {
		var data = {
			resources: [
				{
					resource_id: dropletID,
					resource_type: 'droplet'
				}
			]
		};
		var options = {
			url: this.BASEURL+'tags/'+tag+'/resources',
			headers: this.headers,
			body: JSON.stringify(data)
		};

		return request.post(options, function(error, response, body){
			return callback(body, response, error);
		});
	};
	
	this.dropletCreate = function(args, callback){
		var data = {
			name: args.name, // || return false,
			region: args.region || 'nyc3',
			size: args.size || '512mb',
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

		return request.post(options, function(error, response, body){
			return callback(body, response, error);
		});
	}

	this.dropletDestroy = function(dropletID, callback){
		var options = {
			url: this.BASEURL+'droplets/'+dropletID,
			headers: this.headers
		};

		return request.del(options, function(error, response, body){
			callback(body, response, error);
		});
	};

	this.dropletInfo = function(dropletID, callback){
		var options = {
			url: this.BASEURL+'droplets/'+dropletID,
			headers: this.headers
		};

		return request.get(options, function(error, response, body){
			callback(body, response, error);
		});
	};

	this.tagsList = function(callback){
		var options = {
			url: this.BASEURL+'tags',
			headers: this.headers
		};

		return request.get(options, function(e,r,b){
			callback(b,r,e);
		});
	};

	return this;
}

module.exports = api;
