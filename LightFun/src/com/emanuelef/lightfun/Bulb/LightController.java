package com.emanuelef.lightfun.Bulb;

import android.app.Activity;
import android.graphics.Color;

import com.emanuelef.lightfun.Bulb.LightCommands.ColorCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.LightCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.ModeCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.Modes;
import com.emanuelef.lightfun.Bulb.LightCommands.OnOffCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.Types;
import com.emanuelef.lightfun.Bulb.LightCommands.WarmCommand;

public class LightController {
	public static final int SERVER_PORT = 7878;
	protected LightCommandQueue queue;
	private LightExecutor consumer;
	
	public interface onLightStateReceiver
	{
		void onInitState(LightState state);
		void onConnect();
		void onDisconnect();
	}
	public static class LightState {
		public boolean ison;
		public int color;
	}
	
	public LightController(onLightStateReceiver receiver, Activity activity, String host) {
		queue = new LightCommandQueue();
		consumer = new LightExecutor(queue, receiver, activity, host, SERVER_PORT);
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
			queue.XRemoveType(Types.SET_ONOFF);
			queue.XRemoveType(Types.SET_WARM);
			
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
	
	public void setWarmBright(int brightness) {
		// 0-100 brightness
		WarmCommand cmd;
		final long tstamp = LightCommandQueue.getTimestamp();
		
		queue.lock();
		try {
			queue.XRemoveType(Types.SET_COLOR);
			queue.XRemoveType(Types.SET_ONOFF);
			
			cmd = (WarmCommand) queue.XGetRelevant(Types.SET_WARM, tstamp);
			if (cmd != null) {
				// reuse this
				cmd.time = tstamp;
				cmd.brightness = brightness;
			} else {
				// allocate a new command
				cmd = new WarmCommand();
				cmd.time = tstamp;
				cmd.brightness = brightness;
				queue.XPush(cmd);
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
			queue.XRemoveType(Types.SET_WARM);
			
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
	
	private void setMode(Modes mode) {
		final long tstamp = LightCommandQueue.getTimestamp();
		
		queue.lock();
		try {
			ModeCommand cmd = (ModeCommand) queue.XGetSingle(Types.SET_MODE);
			
			if (cmd != null) {
				// Reset
				cmd.time = tstamp;
				cmd.mode = mode;
			} else {
				cmd = new ModeCommand();
				cmd.time = tstamp;
				cmd.mode = mode;
				queue.XPush(cmd);
			}
		} finally {
			queue.unlock();
		}
	}
	
	public void setCoolMode() { setMode(Modes.MODE_COOL); }
	public void setDiscoMode() { setMode(Modes.MODE_DISCO); }
	public void setSoftMode() { setMode(Modes.MODE_SOFT); }
	
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
