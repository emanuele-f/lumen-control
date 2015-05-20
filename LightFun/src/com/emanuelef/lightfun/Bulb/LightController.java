package com.emanuelef.lightfun.Bulb;

import android.app.Activity;
import android.graphics.Color;

import com.emanuelef.lightfun.Bulb.LightCommands.ColorCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.LightCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.OnOffCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.Types;

public class LightController {
//	public static final String SERVER_HOST = "cdotslash.ns0.it:7878";
	public static final String SERVER_HOST = "192.168.1.2:7878";
	protected LightCommandQueue queue;
	private LightExecutor consumer;
	
	public interface onLightStateReceiver
	{
		void onInitState(LightState state);
	}
	public static class LightState {
		public boolean ison;
		public int color;
	}
	
	public LightController(onLightStateReceiver receiver, Activity activity) {
		queue = new LightCommandQueue();
		consumer = new LightExecutor(queue, receiver, activity, SERVER_HOST);
		new Thread(consumer).start();
	}
	
	int interpolateRGB(int a, int b) {
		return Color.rgb(
				(Color.red(a) + Color.red(b))/2,
				(Color.green(a) + Color.green(b))/2,
				(Color.blue(a) + Color.blue(b))/2
		);
	}
	
	public void setColor(int color) {
		ColorCommand command;
		final long tstamp = LightCommandQueue.getTimestamp();
		
		queue.lock();
		try {
			// see if there is something relevant
			command = (ColorCommand) queue.XGetRelevant(Types.SET_COLOR, tstamp);
			if (command != null) {
				// reuse this
				command.time = tstamp;
//				command.color = interpolateRGB(color, command.color);
				command.color = color;
			} else {
				// allocate a new command
				command = new ColorCommand();
				command.time = tstamp;
				command.color = color;
				queue.XPush(command);
			}
		} finally {
			queue.unlock();
		}
	}
	
	public void setOn(boolean ison) {
		final long tstamp = LightCommandQueue.getTimestamp();
		
		queue.lock();
		try {
			// Remove any color commands
			queue.XRemoveType(Types.SET_COLOR);
			OnOffCommand cmd = (OnOffCommand) queue.XGetSingle(Types.SET_ONOFF);
			if (cmd != null) {
				// Reset
				cmd.time = tstamp;
				cmd.on = ison;
			} else {
				cmd = new OnOffCommand();
				cmd.time = tstamp;
				cmd.on = ison;
				queue.XPush(cmd);
			}
		} finally {
			queue.unlock();
		}
	}
	
	public void finish() {
		consumer.end();
	}
	
	public void queryState() {
		final long tstamp = LightCommandQueue.getTimestamp();
		
		queue.lock();
		try {			
			LightCommand cmd = new LightCommand();
			cmd.time = tstamp;
			cmd.type = Types.QUERY_STATE;
			queue.XPush(cmd);
		} finally {
			queue.unlock();
		}
	}
}
