##### Memory Managment


`free`, `free -h`: 

	display amount of free and used memory in the system.
	* Disclamers:
		- DO NOT USE IN SCRIPT

`/proc/`:
	
	It is actually an kernel application. Looks like a file, but is actually generated on demand by the kernel. All "files" in proc are kernal commands. Interact with these commands as if they were files. 
	

`/proc/meminfo`:
	
	File containing realtime memory info.

`/proc/cpuinfo`:

	cpu info



`/dev`:
	
	DANGER This folder contains physical interfaces to hardware on or connected to the machine. Just don't. Read first. Except `/dev/null` it is a blackhole. 