/*
 * Emanuele Faranda			18/05/2015
 */

package com.emanuelef.lightfun;

import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

// TODO save instance state

public class BrightnessBar extends View {
	protected OnBrightnessBarChangeLister blistener;
	protected int min;
	protected int max;
	protected int current;
	protected int piece;
	protected boolean canjump;
	protected boolean istouched = false; 
	protected RectF inrect;
	protected int tickh;
	protected int tickw;
	
	private int tickcolor;
	private int bgcolor;
	private RectF rrect;
	private Paint rpaint;
	private Paint tpaint;
	private Paint lpaint;
	private Paint tickpaint;
	private Matrix tmatrix;
	private Bitmap thumb;
	
	protected final int BG_RADIUS = 10;
	
	/* Init */
	public BrightnessBar(Context context) {
		super(context);
		init(null, 0);
	}

	public BrightnessBar(Context context, AttributeSet attrs) {
		super(context, attrs);
		init(attrs, 0);
	}

	public BrightnessBar(Context context, AttributeSet attrs, int defStyle) {
		super(context, attrs, defStyle);
		init(attrs, defStyle);
	}
	
	private void init(AttributeSet attrs, int defStyle) {
		TypedArray arr = getContext().getTheme().obtainStyledAttributes(
				attrs, R.styleable.BrightnessBar, 0, 0);
		
		/** get style */
		this.min = arr.getInt(R.styleable.BrightnessBar_min, 0); //TODO saveme
		this.max = arr.getInt(R.styleable.BrightnessBar_max, min+100); //TODO saveme
		this.current = arr.getInt(R.styleable.BrightnessBar_value, min); //TODO saveme
		this.piece = arr.getInt(R.styleable.BrightnessBar_interval, 10); //TODO saveme
		this.canjump = arr.getBoolean(R.styleable.BrightnessBar_canjump, false);
		this.tickh = arr.getInteger(R.styleable.BrightnessBar_tickheight, 5);
		this.tickw = arr.getInteger(R.styleable.BrightnessBar_tickwidth, 2);
		this.tickcolor = arr.getColor(R.styleable.BrightnessBar_tickcolor, 0xfffafafa);
		this.bgcolor = arr.getColor(R.styleable.BrightnessBar_bgcolor, 0xff212121);
		final Drawable dthumb = arr.getDrawable(R.styleable.BrightnessBar_thumb);
		// R.drawable.slider_handle
		arr.recycle();
		
		/** paint prepare */
		this.thumb = ((BitmapDrawable) dthumb).getBitmap();	//TODO saveme
		this.tpaint = new Paint();
		this.tmatrix = new Matrix();
		this.rpaint = new Paint();
		this.rrect = new RectF();
		this.inrect = new RectF();
		this.lpaint = new Paint();
		this.tickpaint = new Paint();
		
		rpaint.setStyle(Paint.Style.FILL);
		rpaint.setColor(bgcolor);
		lpaint.setColor(tickcolor);
		tickpaint.setStyle(Paint.Style.FILL);
		tickpaint.setColor(tickcolor);
		/**/
		
		// make values discrete
		this.setInterval(piece);
	}
	/* */
	
	/** setters / getters */
	public void setMax(int max) {
		this.max = max;
		invalidate();
	}
	
	public void setMin(int min) {
		this.min = min;
		invalidate();
	}
	
	public boolean setValue(int val) {
		if (val >= min && val <= max) {
			this.current = val;
			invalidate();
			recalcThumbPos();
			return true;
		}
		return false;
	}
	
	public void setInterval(int interval) {
		this.piece = interval;
		this.current = getDiscrete(current);
		invalidate();
	}
	
	public int getMax() {
		return this.max;
	}
	
	public int getMin() {
		return this.min;
	}
	
	public int getValue() {
		return this.current;
	}
	
	public int getInterval() {
		return this.piece;
	}
	/* */
	
	/** interfaces */
	public interface OnBrightnessBarChangeLister {
		public void onBrightnessChanged(int brightness);
	}
	
	public void setOnBrightnessBarChangeLister(OnBrightnessBarChangeLister listener) {
		this.blistener = listener;
	}
	/* */
	
	@Override
	protected void onDraw(Canvas canvas) {
		super.onDraw(canvas);
		final int w = thumb.getWidth()/2;
		final int y = getPaddingTop() + thumb.getHeight()/2;
		final int pl = getPaddingLeft();
		final int pr = getPaddingRight();
		
		canvas.drawRoundRect(rrect, BG_RADIUS, BG_RADIUS, rpaint);
		canvas.drawLine(pl+w, y, getWidth()-pl-pr-w, y, lpaint);
		
		// draw ticks
		float x;
		for (int i=min; i<=max; i+=piece) {
			x = posToCursor(i) + w;
			canvas.drawRect(x, y-tickh, x+tickw, y+tickh, tickpaint);
		}
		
		// draw thumb
		canvas.drawBitmap(thumb, tmatrix, tpaint);
	}
	
	@Override
	protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
		// nb: padding is included
		final int desiredWidth = Math.max(
				thumb.getWidth() + getPaddingLeft() + getPaddingRight(),
				getResources().getDimensionPixelSize(R.dimen.bar_length));
	    final int desiredHeight = thumb.getHeight() + getPaddingTop() + getPaddingBottom();
	    final int widthMode = MeasureSpec.getMode(widthMeasureSpec);
	    final int widthSize = MeasureSpec.getSize(widthMeasureSpec);
	    final int heightMode = MeasureSpec.getMode(heightMeasureSpec);
	    final int heightSize = MeasureSpec.getSize(heightMeasureSpec);
	    int width;
	    int height;

	    if (widthMode == MeasureSpec.EXACTLY) {
	        width = widthSize;
	    } else if (widthMode == MeasureSpec.AT_MOST) {
	        width = Math.min(desiredWidth, widthSize);
	    } else {
	        width = desiredWidth;
	    }

	    if (heightMode == MeasureSpec.EXACTLY) {
	        height = heightSize;
	    } else if (widthMode == MeasureSpec.AT_MOST) {
	    	height = Math.min(desiredHeight, heightSize);
	    } else {
	    	height = desiredHeight;
	    }

		setMeasuredDimension(width, height);
	}
	
	@Override
	protected void onSizeChanged (int w, int h, int oldw, int oldh) {
		final float half = thumb.getWidth()/2;
		inrect.left = getPaddingLeft() + half;
		inrect.right = w - getPaddingRight() - inrect.left;
		inrect.top = getPaddingTop();
		inrect.bottom = getPaddingBottom();
		
		rrect.right = w;
		rrect.bottom = h;
		recalcThumbPos();
	}
	
	@Override
	public boolean onTouchEvent(MotionEvent event) {
		switch(event.getAction()) {
		    case MotionEvent.ACTION_DOWN:
		    	final float x = event.getX();
		    	float[] values = new float[9];
		    	tmatrix.getValues(values);
		    	final float ledge = values[Matrix.MTRANS_X];
		    	final float redge = values[Matrix.MTRANS_X] + thumb.getWidth();
		    	
		    	if (canjump || (x >= ledge && x <= redge)) {
		    		istouched = true;
		    		thumbCheckMove(event.getX());
		    	} else
		    		return false;
		        break;
	
		    case MotionEvent.ACTION_MOVE:
		    	if (! istouched)
		    		return false;
		    	
		    	thumbCheckMove(event.getX());
		        break;
	
		    case MotionEvent.ACTION_UP:
		    	if (! istouched)
		    		return false;
		    	istouched = false;
		        break;
		        
		    default:
		    	return false;
		}
	    return true;
	}
	
	protected int getDiscrete(int x) {
		return Math.min(Math.max(piece * (x / piece), min), max);
	}
	
	protected void thumbCheckMove(float x) {
		int newval;
		
		if (x <= inrect.left) {
			newval = min;
		} else if (x >= inrect.right) {
			newval = max;
		} else {
			x -= thumb.getWidth()/2;
			newval = getDiscrete((int)(x / inrect.width() * (max-min)));
		}
		
		if (newval != current) {
			current = newval;
			recalcThumbPos();
			invalidate();
			if (blistener != null)
				blistener.onBrightnessChanged(current);
		}
	}
	
	protected float posToCursor(int pos) {
		return getPaddingLeft() + (pos-min) * inrect.width() / (max-min);
	}
	
	private void recalcThumbPos() {
		tmatrix.setTranslate(posToCursor(current), inrect.top);
	}
}
