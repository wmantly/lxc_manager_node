var request = require('request');


api = function(key){
	if(!key){
		key = require('./secrets.js').doAPI;
	}
	this.url = 'https://digitalocean.com/v2/';
	this.headers = {
		'Content-Type': 'application/json',
		'Authorization': 'Bearer '+key
	}

	this.byTag: function(tag, callback){
		var options = {
			url: this.url+'droplets?tag_name='+tag,
			headers: this.headers
		}
		return request.get(options, function(error, response, body){
			return callback(body, response, error);
		})
	};

	this.setTag: function(id, tag, callback){
		return request.post(url+)
	};
}

api = {
}







var httpOptions = {
		url:'http://' + ip + ':15000',
		body: JSON.stringify({
			code: req.body.code
		})
	};

	return request.post(httpOptions, function(error, response, body){
		body = JSON.parse(body);
		body['ip'] = ip.replace('10.0.', '');
		return res.json(body);
	});

module.exports = api;