package com.emanuelef.lightfun.Bulb;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;

import android.app.Activity;
import android.graphics.Color;
import android.util.Log;

import com.emanuelef.lightfun.Bulb.LightCommands.ColorCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.LightCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.OnOffCommand;
import com.emanuelef.lightfun.Bulb.LightController.LightState;
import com.emanuelef.lightfun.Bulb.LightController.onLightStateReceiver;

public class LightExecutor implements Runnable {
	static final String DEBUG_TAG = "LightExecutor";
	static final int SLEEP_MILLI = 100;
	
	// Protocol specs
	static final String SRVCMD_RGBW = "rgb?";
	static final String SRVCMD_ON = "on";
	static final String SRVCMD_OFF = "off";
	static final String SRVQRY_COLOR = "color";
	static final String SRVQRY_STATE = "ison";
	static final String SRVRPL_BAD = "BAD REQUEST";
	static final String SRVRPL_OFFLINE = "OFFLINE";
	
	boolean dorun = true;
	LightCommandQueue queue;
	onLightStateReceiver receiver;
	Activity activity;
	// TODO turn into URL when using websockets
	String url;
	
	public LightExecutor(LightCommandQueue queue, onLightStateReceiver receiver, Activity activity, String url) {
		this.queue = queue;
		this.receiver = receiver;
		this.activity = activity;
		this.url = url;
	}
	
	// parse state response and notify 
	protected void parse_state(String scolor, String sison) { 
		LightState state = new LightState();
		
		// fill color
		try {
			state.color = Color.parseColor("#"+scolor.substring(2, 8));
		} catch (IllegalArgumentException | IndexOutOfBoundsException exc) {
			Log.e(DEBUG_TAG, "Cannot decode rgb color '" + scolor);
			return;
		}
		
		// fill ison
		if (sison.equals("on"))
			state.ison = true;
		else if (sison.equals("off"))
			state.ison = false;
		else {
			Log.e(DEBUG_TAG, "Cannot decode on/off state '" + sison + "'");
			return;
		}
		
		// Notify result
		if (activity != null) {
			final LightState fstate = state;
			activity.runOnUiThread(new Runnable() {
				@Override
				public void run() {
					receiver.onInitState(fstate);
				}
			});
		}
	}
	
	protected String request(String req) {
		HttpURLConnection con;
		String reply;
		
		// TODO move when using websockets
		URL url;
		try {
			url = new URL("http://" + this.url + "/" + req);
		} catch(MalformedURLException exc) {
			Log.e(DEBUG_TAG, exc.getMessage());
			dorun = false;
			return null;
		}
		
		try {
			con = (HttpURLConnection) url.openConnection();
		} catch(IOException exc) {
			Log.e(DEBUG_TAG, exc.getMessage());
			return null;
		}
		
		try {
			InputStreamReader in = new InputStreamReader(new BufferedInputStream(con.getInputStream()));
			BufferedReader buff = new BufferedReader(in);
			reply = buff.readLine();
		} catch (IOException exc) {
			Log.e(DEBUG_TAG, exc.getMessage());
			return null;
		} finally {
			con.disconnect();
		}
		
		// TODO reinvent connection state and use websocket
		if (reply.equals(SRVRPL_BAD) || reply.equals(SRVRPL_OFFLINE))
			return null;
		return reply;
	}

	@Override
	public void run() {
		LightCommand cmd;
		
		while (dorun) {
			cmd = queue.fetchNext();
			
			if (cmd != null)			
				switch (cmd.type) {
					case SET_COLOR:
						ColorCommand color = (ColorCommand) cmd;
						request(SRVCMD_RGBW + color.toString());
						break;
					case SET_ONOFF:
						OnOffCommand onoff = (OnOffCommand) cmd;
						if (onoff.on)
							request(SRVCMD_ON);
						else
							request(SRVCMD_OFF);
						break;
					case QUERY_STATE:
						String color_r = request(SRVQRY_COLOR);
						String ison_r = request(SRVQRY_STATE);
						if (color_r == null || ison_r == null)
							break;
						parse_state(color_r, ison_r);
						break;
				}
			
			try { Thread.sleep(SLEEP_MILLI); } catch (InterruptedException exc) {}
		}
	}
	
	public void end() {
		dorun = false;
	}
}