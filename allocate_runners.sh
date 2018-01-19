# maxMemoryUsage must be defined

function usedMemoryPercent () {
	memoryAvailable=$(head /proc/meminfo|grep MemAvail|grep -Po '\d+');
	totalMemory=$(head /proc/meminfo|grep MemTotal|grep -Po '\d+');
	difference=$(expr $totalMemory - $memoryAvailable);
	difference=$(expr $difference \* 100);
	memory=$(expr $difference / $totalMemory);
}

function buildRunners () {
	baseName="crunner0";
	namePrefix="crunner-batch-${RANDOM}";
	runners="";
	usedMemoryPercent;

	# maxMemoryUsage must be defined
	until [[ $memory -gt $maxMemoryUsage ]]; do
		
		runnerName="${namePrefix}-id-${RANDOM}";
		lxc-start-ephemeral -o $baseName -n $runnerName --union-type overlayfs -d > /dev/null;
		
		if [[ $? -eq 0 ]]; then
			runners="${runners};${runnerName}";
		fi
		usedMemoryPercent;
	done
}

buildRunners;
lxc-ls --fancy;

exit 0;