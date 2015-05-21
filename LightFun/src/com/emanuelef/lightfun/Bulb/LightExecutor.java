package com.emanuelef.lightfun.Bulb;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.SocketAddress;
import java.net.SocketException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.channels.SocketChannel;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CharsetEncoder;

import android.app.Activity;
import android.graphics.Color;
import android.util.Log;

import com.emanuelef.lightfun.Bulb.LightCommands.ColorCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.LightCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.OnOffCommand;
import com.emanuelef.lightfun.Bulb.LightCommands.WarmCommand;
import com.emanuelef.lightfun.Bulb.LightController.LightState;
import com.emanuelef.lightfun.Bulb.LightController.onLightStateReceiver;

public class LightExecutor implements Runnable {
	static final String DEBUG_TAG = "LightExecutor";
	static final int SLEEP_MILLI = 100;
	static final int KEEP_ALIVE_SECS = 5;
	
	// Protocol specs
	static final String SRVCMD_KEEPALIVE = "";
	static final String SRVCMD_RGBW = "/rgb?";
	static final String SRVCMD_WARM = "/warm?";
	static final String SRVCMD_ON = "/on";
	static final String SRVCMD_OFF = "/off";
	static final String SRVQRY_COLOR = "/color";
	static final String SRVQRY_STATE = "/ison";
	static final String SRVRPL_END = "$";
	static final String SRVRPL_BAD = "BAD REQUEST";
	static final String SRVRPL_OFFLINE = "OFFLINE";
	
	SocketChannel sock;
	
	boolean dorun = true;
	LightCommandQueue queue;
	onLightStateReceiver receiver;
	Activity activity;
	SocketAddress addr;
	ByteBuffer rbuf = ByteBuffer.allocate(256);
	CharsetEncoder encoder;
	CharsetDecoder decoder;
	long alivetime;
	
	public LightExecutor(LightCommandQueue queue, onLightStateReceiver receiver, Activity activity, String host, int port) {
		this.queue = queue;
		this.receiver = receiver;
		this.activity = activity;
		
		Charset charset = Charset.forName("UTF-8");
		this.encoder = charset.newEncoder();
		this.decoder = charset.newDecoder();
		
		try {
			this.sock = SocketChannel.open();
			sock.configureBlocking(true);
		} catch (IOException exc) {
			Log.e(DEBUG_TAG, exc.getMessage());
			dorun = false;
			return;
		}
		
		this.addr = new InetSocketAddress(host, port);
	}
	
	protected void onConnect() {
		Log.d(DEBUG_TAG, "Gateway connection opened");
		alivetime = LightCommandQueue.getTimestamp();
		try {
			sock.socket().setTcpNoDelay(true);
		} catch (SocketException exc) {
			// may cause keepalive troubles
			Log.w(DEBUG_TAG, "Cannot set socket 'NoDelay' mode");
		}
		
		// Notify connection
		if (activity != null) {
			activity.runOnUiThread(new Runnable() {
				@Override
				public void run() {
					receiver.onConnect();
				}
			});
		}
	}
	
	protected void onDisconnect() {
		Log.d(DEBUG_TAG, "Gateway connection closed");
		
		// Notify disconnection
		if (activity != null) {
			activity.runOnUiThread(new Runnable() {
				@Override
				public void run() {
					receiver.onDisconnect();
				}
			});
		}
	}
	
	protected void onMessage(String message) {
		// TODO implement bidirectional logic
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
	
	// buffer logic inside
	protected String getReply() throws IOException {
		String reply = "";
		final int maxiter = 10;
		int i=0;
		int c;
		
		do {
			c = sock.read(rbuf);
			rbuf.flip();		// make the buffer ready for reading
			if (c > 0) {
				reply += decoder.decode(rbuf);
			}
			i++;
		} while (!reply.contains(SRVRPL_END) && i <= maxiter);
		
		if (i > maxiter) {
			Log.w(DEBUG_TAG, "Cannot get a reply :/");
			return null;
		}
		reply = reply.substring(0, reply.indexOf(SRVRPL_END));
		if (reply.equals(SRVRPL_BAD) || reply.equals(SRVRPL_OFFLINE))
			return null;
		return reply;
	}
	
	protected String request(String req) {
		try {
			sock.write(encoder.encode(CharBuffer.wrap(req+SRVRPL_END)));
			// keepalive does not expect a reply
			if (! req.equals(SRVCMD_KEEPALIVE))
				return getReply();
		} catch (IOException exc) {
			Log.w(DEBUG_TAG, "Cannot write request: " + exc.getMessage());
			if (! sock.isConnected())
				onDisconnect();
		}
		return null;
	}

	@Override
	public void run() {
		LightCommand cmd;
		
		while (dorun) {
			if (! sock.isConnected()) {
				try {
					sock.connect(addr);
					onConnect();
				} catch (IOException e) {}
			}
			
			if (sock.isConnected())
				cmd = queue.fetchNext();
			else
				cmd = null;
			
			if (cmd != null) {
				Log.d(DEBUG_TAG, "Processing command: " + cmd.type);
				// alive timer is reset
				alivetime = LightCommandQueue.getTimestamp();
				
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
					case SET_WARM:
						WarmCommand warm = (WarmCommand) cmd;
						request(SRVCMD_WARM + warm.brightness);
						break;
					case QUERY_STATE:
						String color_r = request(SRVQRY_COLOR);
						String ison_r = request(SRVQRY_STATE);
						if (color_r == null || ison_r == null)
							break;
						parse_state(color_r, ison_r);
						break;
				}
			} else {
				// Check if we need to send keep alive
				long curtime = LightCommandQueue.getTimestamp();
				if (sock.isConnected() && 
						(curtime - alivetime)/1000 >= KEEP_ALIVE_SECS) {
					request(SRVCMD_KEEPALIVE);
					alivetime = curtime;
				}
			}
			
			try { Thread.sleep(SLEEP_MILLI); } catch (InterruptedException exc) {}
		}
		
		try { sock.close(); } catch (IOException exc) {}
	}
	
	public void end() {
		dorun = false;
	}
}