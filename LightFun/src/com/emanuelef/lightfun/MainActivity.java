package com.emanuelef.lightfun;

import android.support.v7.app.AppCompatActivity;
import android.support.v4.app.Fragment;
import android.content.res.Resources;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.AdapterView.OnItemSelectedListener;
import android.widget.CompoundButton;
import android.widget.CompoundButton.OnCheckedChangeListener;
import android.widget.Spinner;
import android.widget.ToggleButton;

import com.emanuelef.lightfun.BrightnessBar.OnBrightnessBarChangeLister;
import com.emanuelef.lightfun.Bulb.LightController;
import com.emanuelef.lightfun.Bulb.LightController.LightState;
import com.emanuelef.lightfun.Bulb.LightController.onLightStateReceiver;
import com.larswerkman.holocolorpicker.ColorPicker;
import com.larswerkman.holocolorpicker.ColorPicker.OnColorChangedListener;
import com.larswerkman.holocolorpicker.SVBar;

public class MainActivity extends AppCompatActivity implements OnColorChangedListener,
	OnBrightnessBarChangeLister, OnCheckedChangeListener,  onLightStateReceiver, OnItemSelectedListener {
	PlaceholderFragment fragment;
	LightController bulb;
	String host;
	
	// Do not edit manually, use setup.sh with --local and --remote
	public static final String SERVER_LOCAL = "192.168.1.77";
	public static final String SERVER_REMOTE = "2.231.26.11";

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		setContentView(R.layout.activity_main);
		
		if (savedInstanceState == null) {
			fragment = new PlaceholderFragment();
			getSupportFragmentManager().beginTransaction()
					.add(R.id.container, fragment).commit();
		} else {
			fragment = (PlaceholderFragment) getSupportFragmentManager().getFragments().get(0);
		}
		
		this.host = SERVER_REMOTE;
		this.bulb = new LightController(this, this, host);
	}
	
	@Override
	protected void onDestroy() {
		super.onDestroy();
		bulb.finish();		
	}

	@Override
	public boolean onCreateOptionsMenu(Menu menu) {
		// Inflate the menu; this adds items to the action bar if it is present.
		getMenuInflater().inflate(R.menu.main, menu);
		return true;
	}

	@Override
	public boolean onOptionsItemSelected(MenuItem item) {
		// Handle action bar item clicks here. The action bar will
		// automatically handle clicks on the Home/Up button, so long
		// as you specify a parent activity in AndroidManifest.xml.
		int id = item.getItemId();
		if (id == R.id.action_settings) {
			return true;
		}
		return super.onOptionsItemSelected(item);
	}
	
	private int getModeIndex(int moderes) {
		Resources res = getResources();
		String mode = res.getString(moderes);
		String[] modes = res.getStringArray(R.array.modes);
		
		for (int i = 0; i < modes.length; i++) {
			if (modes[i].equals(mode))
				return i;
		}
		return -1;
	}
	
	@Override
	public void onColorChanged(int color) {
		fragment.modified = true;
		fragment.modesel.setSelection(getModeIndex(R.string.mode_color));
		bulb.setColor(color);
	}

	@Override
	public void onBrightnessChanged(int brightness) {
		bulb.setWarmBright(brightness);
		fragment.modesel.setSelection(getModeIndex(R.string.mode_warm));
	}
	
	@Override
	public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
		switch (buttonView.getId()) {
		case R.id.onoff:
			fragment.modified = true;
			bulb.setOn(isChecked);
			break;
		}
		
	}
	
	@Override
	public void onInitState(LightState state) {
		// TODO also get and set current mode and brightness
		if (! fragment.modified)
			fragment.picker.setColor(state.color);
		fragment.onoff.setChecked(state.ison);
	}

	@Override
	public void onConnect() {
		bulb.queryState();
		fragment.constatus.setChecked(true);
		fragment.modified = false;
	}

	@Override
	public void onDisconnect() {
		// TODO Auto-generated method stub
		fragment.constatus.setChecked(false);
	}
	
	private void onHostSel(String item) {
		String nhost = null;
		Resources res = getResources();
		
		if (item.equals(res.getString(R.string.localserver)))
			nhost = SERVER_LOCAL;
		else if (item.equals(res.getString(R.string.remoteserver)))
			nhost = SERVER_REMOTE;
		
		if (nhost != host) {
			host = nhost;
			if (bulb != null)
				bulb.finish();
			this.bulb = new LightController(this, this, host);
		}
	}
	
	private void onModeSel(String item) {
		Resources res = getResources();
		
		if (item.equals(res.getString(R.string.mode_color)))
			bulb.setColor(fragment.getColor());
		else if (item.equals(res.getString(R.string.mode_warm)))
			bulb.setWarmBright(fragment.getBrightness());
		else if (item.equals(res.getString(R.string.mode_disco)))
			bulb.setDiscoMode();
		else if (item.equals(res.getString(R.string.mode_cool)))
			bulb.setCoolMode();
		else if (item.equals(res.getString(R.string.mode_soft)))
			bulb.setSoftMode();
	}
	
	@Override
	public void onItemSelected(AdapterView<?> parent, View view, int position,
			long id) {
		// generated by hostsel
		String item  = (String) parent.getItemAtPosition(position);
		switch(parent.getId()) {
		case R.id.hostsel:
			onHostSel(item);
			break;
		case R.id.modesel:
			onModeSel(item);
			break;
		}
	}
	@Override
	public void onNothingSelected(AdapterView<?> parent) {}

	/**
	 * A placeholder fragment containing a simple view.
	 */
	public static class PlaceholderFragment extends Fragment {
		// Used to get initial state
		boolean modified = false;
		ToggleButton onoff;
		ToggleButton constatus;
		ColorPicker picker;
		BrightnessBar brbar;
		Spinner hostsel;
		Spinner modesel;
		
		@Override
		public View onCreateView(LayoutInflater inflater, ViewGroup container,
				Bundle savedInstanceState) {
			View rootView = inflater.inflate(R.layout.fragment_main, container,
					false);
			MainActivity activity = (MainActivity) getActivity();
			
			// Setup ColorPicker
			picker = (ColorPicker) rootView.findViewById(R.id.picker);
			picker.setShowOldCenterColor(false);
			SVBar svBar = (SVBar) rootView.findViewById(R.id.svbar);
			picker.addSVBar(svBar);
			picker.setOnColorChangedListener(activity);

			// Setup brightness bar
			brbar = (BrightnessBar) rootView.findViewById(R.id.brbar);
			brbar.setOnBrightnessBarChangeLister(activity);
			
			// Setup buttons
			onoff = (ToggleButton) rootView.findViewById(R.id.onoff);
			onoff.setOnCheckedChangeListener(activity);
			constatus = (ToggleButton) rootView.findViewById(R.id.constatus);
			hostsel = (Spinner) rootView.findViewById(R.id.hostsel);
			hostsel.setOnItemSelectedListener(activity);
			modesel = (Spinner) rootView.findViewById(R.id.modesel);
			modesel.setOnItemSelectedListener(activity);

			return rootView;
		}
		
		public int getBrightness() {
			return brbar.getValue();
		}
		
		public int getColor() {
			return picker.getColor();
		}
	}
}
