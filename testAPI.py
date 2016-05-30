import requests as r
import time

def testAPI(times):
	errors = 0

	for i in range(times):
		res = r.post('http://codeland.bytedev.co:2000/api/run', data={'code': 'pwd'})
		if res.status_code != 200: errors +=1
	print('errors ', errors)