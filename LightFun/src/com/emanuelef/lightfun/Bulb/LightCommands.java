package com.emanuelef.lightfun.Bulb;

import android.graphics.Color;

public class LightCommands {
	public enum Types { SET_COLOR, SET_ONOFF, QUERY_STATE };
	
	public static class LightCommand {
		protected Types type;
		public long time;
		
		public Types getType() {
			return this.type;
		}
	}
	
	public static class ColorCommand extends LightCommand {
		public int color;
		
		public ColorCommand() {
			this.type = Types.SET_COLOR;
		}
		
		public String toString() {
			return String.format("0x%02x%02x%02x", Color.red(color),
					Color.green(color), Color.blue(color));
		}
	}
	
	public static class OnOffCommand extends LightCommand {
		public boolean on;
		
		public OnOffCommand() {
			this.type = Types.SET_ONOFF;
		}
	}
}
