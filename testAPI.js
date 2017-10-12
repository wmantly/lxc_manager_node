const request = require('request');

var callRunner = (function(){
	let started = 0;
	let completed = 0;
	let errors = 0;
	let noRunner = 0;

	let func = function(code, callback) {
			// code | `string` block of code to send runner or
			//		  `number` sleep timeout in seconds
			let sleepTime = 0;
			let id = started++;
			callback = callback || function(){};

			if(/^\+?(0|[1-9]\d*)$/.test(code)){
				sleepTime = code;
				code = null; 
			}
			console.log(id, ': Running...');

			
			let httpOptions = {
				url: 'http://localhost:2000/api/run?once=true',
				form: {
					code: code || `python3 -c "
from time import sleep
sleep(${sleepTime})
					"`,
				}
			};

			return request.post(httpOptions, function(error, response, body){
				completed++;
				let res = ``;
				if(response.statusCode == 503){
					noRunner++;
				}else if(error || response.statusCode !== 200){
					errors++;
					console.log(`
						ID: ${id} 
						Error: ${error}
					`);
				} else {	
					body = JSON.parse(body);
					res = (Buffer.from(body.res, 'base64').toString('ascii'));
				}
				console.log(`${id} with results ${res}. Errors ${errors}. No runner ${noRunner}. Completed ${completed}`);

				callback()

			});
	};

	return func;
})();


let __do = function(till){
	if(!till) return ;

	callRunner(String(Math.random())[3]);
	setTimeout(__do, 1500, --till);
};

__do(1000);
