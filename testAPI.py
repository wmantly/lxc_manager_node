import requests as r
import time

def testAPI(times=100, sleep=2):
	errors = 0

	for i in range(times):
		try:
			res = r.post(
				'http://127.0.0.1:2000/api/run',
				data={'code': 'pwd'},
				params={'once': True}
			)
			if res.status_code != 200: errors += 1
			print(i, res.status_code, res.content)
		except:
			print('caught error')
			errors += 1
		time.sleep(sleep)
	print('errors ', errors, (errors/times)*100)
