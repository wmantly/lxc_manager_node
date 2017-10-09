const request = require('request');

var till = 5;
var completed = 0;
var errors = 0;

for(let i=0; i<till; i++){
	console.log('calling', i);
	let httpOptions = {
		url: 'http://codeland.bytedev.co:2000/api/run?once=true',
		form: {
			code: `python3 -c "
from time import sleep
sleep(10)
			"`,
		}
	};
	request.post(httpOptions, function(error, response, body){
		completed++;
		if(error || response.statusCode !== 200){
			errors++;
		}

		body = JSON.parse(body);
		let res = (Buffer.from(body.res, 'base64').toString('ascii'));
		console.log(i, res);
		if(completed===till){
			console.log(errors);
		}
	});
}

