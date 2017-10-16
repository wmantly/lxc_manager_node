baseName="crunner0";
namePrefix="cubs";
runners="";

function usedMemoryPercent () {
	memoryAvailable=$(head /proc/meminfo|grep MemAvail|grep -Po '\d+');
	totalMemory=$(head /proc/meminfo|grep MemTotal|grep -Po '\d+');
	difference=$(expr $totalMemory - $memoryAvailable);
	difference=$(expr $difference \* 100);
	memory=$(expr $difference / $totalMemory);
}


usedMemoryPercent;
until [[ $memory -gt $maxMemoryUsage ]]; do
	
	runnerName="${namePrefix}${RANDOM}";
	lxc-start-ephemeral -o $baseName -n $runnerName --union-type overlayfs -d;
	
	if [[ "$?" -eq 0 ]]; then
		runners="${runnerName};${runners}";
	fi
	usedMemoryPercent;
done

echo $runners;