package com.emanuelef.lightfun;

import android.support.v7.app.AppCompatActivity;
import android.support.v4.app.Fragment;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CompoundButton;
import android.widget.CompoundButton.OnCheckedChangeListener;
import android.widget.ToggleButton;

import com.emanuelef.lightfun.BrightnessBar.OnBrightnessBarChangeLister;
import com.emanuelef.lightfun.Bulb.LightController;
import com.emanuelef.lightfun.Bulb.LightController.LightState;
import com.emanuelef.lightfun.Bulb.LightController.onLightStateReceiver;
import com.larswerkman.holocolorpicker.ColorPicker;
import com.larswerkman.holocolorpicker.ColorPicker.OnColorChangedListener;
import com.larswerkman.holocolorpicker.SVBar;

public class MainActivity extends AppCompatActivity implements OnColorChangedListener,
	OnBrightnessBarChangeLister, OnCheckedChangeListener {
	PlaceholderFragment fragment;
	LightController bulb;

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
		
		this.bulb = new LightController(fragment, this);
		bulb.queryState();
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
	
	@Override
	public void onColorChanged(int color) {
		fragment.unchanged_color = false;
		bulb.setColor(color);
	}

	@Override
	public void onBrightnessChanged(int brightness) {
		Log.d("", String.format("TODO Brightness: %d", brightness));
//		fragment.unchanged_color = false;
	}
	
	@Override
	public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
		// onoff button change
		fragment.unchanged_button = false;
		bulb.setOn(isChecked);
	}

	/**
	 * A placeholder fragment containing a simple view.
	 */
	public static class PlaceholderFragment extends Fragment implements onLightStateReceiver {
		// Used to get initial state
		boolean unchanged_button = true;
		boolean unchanged_color = true;
		ToggleButton onoff;
		ColorPicker picker;
		BrightnessBar brbar;
		
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
			
			// Setup onoff button
			onoff = (ToggleButton) rootView.findViewById(R.id.onoff);
			onoff.setOnCheckedChangeListener(activity);

			return rootView;
		}
		
		@Override
		public void onInitState(LightState state) {
			if (unchanged_color)
				picker.setColor(state.color);
			if (unchanged_button)
				onoff.setChecked(state.ison);
		}
		
		public int getBrightness() {
			return brbar.getValue();
		}
		
		public int getColor() {
			return picker.getColor();
		}
	}
}
