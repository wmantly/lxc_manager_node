var request = require('request');


api = function(key){
	key = key || require('./secrets.js').doAPI;
	this.BASEURL = 'https://api.digitalocean.com/v2/';
	
	this.headers = {
		'Content-Type': 'application/json',
		'Authorization': 'Bearer '+key
	}

	this.byTag = function(tag, callback){
		var options = {
			url: this.BASEURL+'droplets?tag_name='+tag,
			headers: this.headers
		}
		
		return request.get(options, function(error, response, body){
			return callback(body, response, error);
		})
	};

	// this.setTag = function(id, tag, callback){
	// 	return request.post(url+)
	// };
	return this;
}

module.exports = api;