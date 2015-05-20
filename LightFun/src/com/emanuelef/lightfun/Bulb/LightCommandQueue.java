package com.emanuelef.lightfun.Bulb;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

import com.emanuelef.lightfun.Bulb.LightCommands.LightCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.Types;

public class LightCommandQueue {
	static final long AFFINITY_MILLIS = 200;	// how many max time diff a command has affinity with another
	
	Lock mutex = new ReentrantLock();
	List<LightCommand> queue = new ArrayList<LightCommand>();
	
	// Get exclusive access to queue state (for using with "X"methods)
	public void lock() {
		mutex.lock();
	}
	
	public void unlock() {
		mutex.unlock();
	}
	
	public static long getTimestamp() {
		return android.os.SystemClock.elapsedRealtime();
	}
	
	// Find the most relevant (timestamp based) command, by type - AFFINITY_MILLIS
	public LightCommand XGetRelevant(Types type, long tstamp) {
		LightCommand rel = null;
		
		for (int i=0; i<queue.size(); i++) {
			LightCommand cmd = queue.get(i);
			if (cmd.type == type) {
				if (Math.abs(cmd.time - tstamp) < AFFINITY_MILLIS && (rel == null || Math.abs(cmd.time - tstamp) < Math.abs(rel.time - tstamp)))
					rel = cmd;
			}
		}
		
		return rel;
	}
	
	public void XPush(LightCommand com) {
		queue.add(com);
	}
	
	// Asserts only one item of given type exists - returns it
	public LightCommand XGetSingle(Types type) {
		for (int i=0; i<queue.size(); i++) {
			LightCommand cmd = queue.get(i);
			if (cmd.type == type)
				return cmd;
		}
		return null;
	}
	
	public LightCommand XPop() {
		if (queue.isEmpty())
			return null;
		return queue.remove(0);
	}
	
	// Remove all items of this type from queue
	public void XRemoveType(Types type) {	
		Iterator<LightCommand> iter = queue.iterator();
		
		while (iter.hasNext()) {
			LightCommand cmd = iter.next();
			if (cmd.type == type)
				iter.remove();
		}
	}
	
	// Fetches next command by timestamp
	public LightCommand fetchNext() {
		LightCommand sel = null;
		int k = -1;
		this.lock();
		
		try {
			for (int i=0; i<queue.size(); i++) {
				LightCommand cmd = queue.get(i);
				if (sel == null || cmd.time < sel.time ) {
					k = i;
					sel = cmd;
				}
			}
		} finally {
			this.unlock();			
		}
		
		if (sel != null)
			queue.remove(k);
		return sel;
	}
	
	public void XClear() {
		this.queue.clear();
	}
}
