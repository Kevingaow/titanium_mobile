/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2013 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */

package ti.modules.titanium.ui;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.HashMap;

import org.appcelerator.kroll.KrollDict;
import org.appcelerator.kroll.annotations.Kroll;
import org.appcelerator.kroll.common.Log;
import org.appcelerator.titanium.TiActivity;
import org.appcelerator.titanium.TiActivityWindow;
import org.appcelerator.titanium.TiActivityWindows;
import org.appcelerator.titanium.TiApplication;
import org.appcelerator.titanium.TiBaseActivity;
import org.appcelerator.titanium.TiC;
import org.appcelerator.titanium.TiDimension;
import org.appcelerator.titanium.TiTranslucentActivity;
import org.appcelerator.titanium.animation.TiAnimator;
import org.appcelerator.titanium.proxy.ActionBarProxy;
import org.appcelerator.titanium.proxy.ActivityProxy;
import org.appcelerator.titanium.proxy.DecorViewProxy;
import org.appcelerator.titanium.proxy.TiViewProxy;
import org.appcelerator.titanium.proxy.TiWindowProxy;
import org.appcelerator.titanium.util.TiConvert;
import org.appcelerator.titanium.util.TiUtils;
import org.appcelerator.titanium.view.TiCompositeLayout;
import org.appcelerator.titanium.util.TiRHelper;
import org.appcelerator.titanium.view.TiUIView;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.support.annotation.Nullable;
import android.transition.ChangeBounds;
import android.transition.ChangeClipBounds;
import android.transition.ChangeImageTransform;
import android.transition.ChangeTransform;
import android.transition.Explode;
import android.transition.Fade;
import android.transition.Slide;
import android.transition.Transition;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup.LayoutParams;
import android.view.Window;
import android.view.WindowManager;

@Kroll.proxy(creatableInModule=UIModule.class, propertyAccessors={
    TiC.PROPERTY_DISPLAY_HOME_AS_UP,
	TiC.PROPERTY_URL,
	TiC.PROPERTY_MODAL,
	TiC.PROPERTY_WINDOW_PIXEL_FORMAT,
	TiC.PROPERTY_FLAG_SECURE
})
public class WindowProxy extends TiWindowProxy implements TiActivityWindow
{
	private static final String TAG = "WindowProxy";
	protected static final String PROPERTY_POST_WINDOW_CREATED = "postWindowCreated";
	private static final String PROPERTY_LOAD_URL = "loadUrl";

	private static final int MSG_FIRST_ID = TiViewProxy.MSG_LAST_ID + 1;
	private static final int MSG_SET_PIXEL_FORMAT = MSG_FIRST_ID + 100;
	private static final int MSG_SET_TITLE = MSG_FIRST_ID + 101;
//	private static final int MSG_SET_WIDTH_HEIGHT = MSG_FIRST_ID + 102;
	private static final int MSG_REMOVE_LIGHTWEIGHT = MSG_FIRST_ID + 103;
	protected static final int MSG_LAST_ID = MSG_FIRST_ID + 999;

	protected WeakReference<TiBaseActivity> windowActivity;

	// This flag is just for a temporary use. We won't need it after the lightweight window
	// is completely removed.
	private boolean lightweight = false;

	public WindowProxy()
	{
		super();
	}  

	@Override
	protected KrollDict getLangConversionTable()
	{
		KrollDict table = new KrollDict();
		table.put(TiC.PROPERTY_TITLE, TiC.PROPERTY_TITLEID);
		return table;
	}
	
	private class TiWindowView extends TiUIView{
		public TiWindowView(TiViewProxy proxy) {
			super(proxy);
			layoutParams.autoFillsHeight = true;
			layoutParams.autoFillsWidth = true;
			layoutParams.sizeOrFillWidthEnabled = true;
			layoutParams.sizeOrFillHeightEnabled = true;
			TiCompositeLayout layout = new TiCompositeLayout(proxy.getActivity(), this);
			setNativeView(layout);
		}
        @Override
	    protected int fillLayout(String key, Object value, boolean withMatrix) {
            if (!lightweight && (key.equals(TiC.PROPERTY_WIDTH) || key.equals(TiC.PROPERTY_HEIGHT))) {
                Object width = getProperty(TiC.PROPERTY_WIDTH);
                Object height = getProperty(TiC.PROPERTY_HEIGHT);
                setWindowWidthHeight(width, height);
                return 0;
            }
	        return TiConvert.fillLayout(key, value, layoutParams, true);
	    }
        @Override
        public void propertySet(String key, Object newValue, Object oldValue,
                boolean changedProperty) {
            TiBaseActivity activity = getWindowActivity();
            
            switch (key) {
            case TiC.PROPERTY_WINDOW_PIXEL_FORMAT:
                getMainHandler().obtainMessage(MSG_SET_PIXEL_FORMAT, newValue)
                        .sendToTarget();
                break;
            case TiC.PROPERTY_TITLE:
                getMainHandler().obtainMessage(MSG_SET_TITLE, newValue)
                        .sendToTarget();
                break;
            case TiC.PROPERTY_TOUCH_ENABLED:
                if (activity != null && activity.isCurrentWindow(WindowProxy.this)) {
                    if (TiConvert.toBoolean(newValue, true)) {
                        activity.getWindow()
                                .clearFlags(
                                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                                                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
                    } else {
                        activity.getWindow()
                                .addFlags(
                                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                                                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
                    }
                }
                break;
            case TiC.PROPERTY_FULLSCREEN:
                if (changedProperty && activity != null && activity.isCurrentWindow(WindowProxy.this)) {
                    activity.setFullscreen(TiConvert.toBoolean(newValue, false));
                }
                break;
            case TiC.PROPERTY_FOCUSABLE:
                if (activity != null && activity.isCurrentWindow(WindowProxy.this)) {
                    if (TiConvert.toBoolean(newValue, true)) {
                        activity.getWindow().clearFlags(
                                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
                    } else {
                        activity.getWindow().addFlags(
                                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
                    }
                }
                break;
            case TiC.PROPERTY_EXIT_ON_CLOSE:
                if (activity != null && activity.isCurrentWindow(WindowProxy.this)) {
                    Intent intent = activity.getIntent();
                    intent.putExtra(TiC.INTENT_PROPERTY_FINISH_ROOT,
                            TiConvert.toBoolean(newValue));
                }
                break;
            case TiC.PROPERTY_TOP:
            case TiC.PROPERTY_BOTTOM:
            case TiC.PROPERTY_LEFT:
            case TiC.PROPERTY_RIGHT:
            
                if (!lightweight) {
                    break;
                }
                break;

            case "statusBarColor": {
                if (TiC.LOLLIPOP_OR_GREATER) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                    getWindow().setStatusBarColor(TiConvert.toColor(newValue));
                }
                break;
            }
            case "navigationBarColor": {
                if (TiC.LOLLIPOP_OR_GREATER) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                    getWindow().setNavigationBarColor(TiConvert.toColor(newValue));
                }
                break;
            }
            case TiC.PROPERTY_WIDTH:
            case TiC.PROPERTY_HEIGHT:
            default:
                if (changedProperty && ActionBarProxy.windowProps().contains(key)) {
                    String realKey = TiUtils.mapGetOrDefault(ActionBarProxy.propsToReplace(), key, key);
                    if (activity != null && activity.isCurrentWindow(WindowProxy.this)) {
                        ActivityProxy activityProxy = activity.getActivityProxy();
                        ActionBarProxy aBarProxy = activityProxy.getOrCreateActionBarProxy();
                        if (aBarProxy != null) {
                            aBarProxy.setPropertyAndFire(realKey, newValue);
                        }
                        //we also need to update actionBar property if it exists
                        HashMap actionbarProps = TiConvert.toHashMap(activityProxy.getProperty(TiC.PROPERTY_ACTION_BAR));
                        if (actionbarProps != null) {
                            actionbarProps.put(realKey, newValue);
                        }
                    }
                    
                }else {
                    super.propertySet(key, newValue, oldValue, changedProperty);
                }
                break;
            }
            
        }
	}
	
	
	 
	
	@Override
	public TiUIView createView(Activity activity)
	{
//		TiUIView v = new TiWindowView(this);
//		setView(v);
		return new TiWindowView(this);
	}

	public boolean addLightweightWindowToStack() 
	{
		// Add LW window to the decor view and add it to stack.
		Activity topActivity = TiApplication.getAppCurrentActivity();
		if (topActivity instanceof TiBaseActivity) {
			TiBaseActivity baseActivity = (TiBaseActivity) topActivity;
			ActivityProxy activityProxy = baseActivity.getActivityProxy();
			if (activityProxy != null) {
				DecorViewProxy decorView = activityProxy.getDecorView();
				if (decorView != null) {
					decorView.add(this);
					windowActivity = new WeakReference<TiBaseActivity>(baseActivity);

					// Need to handle the url window in the JS side.
					callPropertySync(PROPERTY_LOAD_URL, null);

//					state = State.OPENED;
			        needsOpenEvent = true;
					// fireEvent(TiC.EVENT_OPEN, null);

					baseActivity.addWindowToStack(this);
					return true;
				}
			}
		}
		Log.e(TAG, "Unable to open the lightweight window because the current activity is not available.");
		return false;
	}

	public void removeLightweightWindowFromStack()
	{
		// Remove LW window from decor view and remove it from stack
        closeFromActivity(true);
	}
	
	private static final ArrayList<String> KEYS_TO_KEEP;
    static{
      ArrayList<String> tmp = new ArrayList<String>();
      tmp.add(TiC.PROPERTY_FULLSCREEN);
      tmp.add(TiC.PROPERTY_ORIENTATION_MODES);
      tmp.add(TiC.PROPERTY_LIGHTWEIGHT);
      tmp.add(TiC.PROPERTY_MODAL);
      tmp.add(TiC.PROPERTY_NAV_BAR_HIDDEN);
      tmp.add(TiC.PROPERTY_WINDOW_SOFT_INPUT_MODE);
      KEYS_TO_KEEP = tmp;
    }

	@Override
	public void open(@Kroll.argument(optional = true) Object arg)
	{
		HashMap<String, Object> option = null;
		if (arg instanceof HashMap) {
			option = (HashMap<String, Object>) arg;
			if (option != null) {
	            KrollDict props = TiConvert.toKrollDict(option);
	            props.keySet().retainAll(KEYS_TO_KEEP);
	            properties.putAll(props);
	        }
		}
		if (hasProperty(TiC.PROPERTY_ORIENTATION_MODES)) {
			Object obj = getProperty(TiC.PROPERTY_ORIENTATION_MODES);
			if (obj instanceof Object[]) {
				orientationModes = TiConvert.toIntArray((Object[]) obj);
			}
		}

		if (hasProperty(TiC.PROPERTY_LIGHTWEIGHT))
		{
			lightweight = TiConvert.toBoolean(getProperty(TiC.PROPERTY_LIGHTWEIGHT), false);
		}

		// When we open a window using tab.open(win), we treat it as opening a HW window on top of the tab.
		if (hasProperty("tabOpen")) {
			lightweight = false;

		// If "ti.android.useLegacyWindow" is set to true in the tiapp.xml, follow the old window behavior:
		// create a HW window if any of the four properties, "fullscreen", "navBarHidden", "windowSoftInputMode" and
		// "modal", is specified; otherwise create a LW window.
		} else if (TiApplication.USE_LEGACY_WINDOW && !hasProperty(TiC.PROPERTY_FULLSCREEN)
			&& !hasProperty(TiC.PROPERTY_NAV_BAR_HIDDEN) && !hasProperty(TiC.PROPERTY_WINDOW_SOFT_INPUT_MODE)
			&& !hasProperty(TiC.PROPERTY_MODAL)) {
			lightweight = true;
		}

		if (Log.isDebugModeEnabled()) {
			Log.d(TAG, "open the window: lightweight = " + lightweight, Log.DEBUG_MODE);
		}

//		if (lightweight) {
//			addLightweightWindowToStack();
//		} else {
			// The "top", "bottom", "left" and "right" properties do not work for heavyweight windows.
//			properties.remove(TiC.PROPERTY_TOP);
//			properties.remove(TiC.PROPERTY_BOTTOM);
//			properties.remove(TiC.PROPERTY_LEFT);
//			properties.remove(TiC.PROPERTY_RIGHT);
			super.open(arg);
//		}
	}
	
	@Override
	public void close(@Kroll.argument(optional = true) Object arg)
	{
	    if (!isOpenedOrOpening()) { 
            return; 
        }
		if (lightweight) {
			if (TiApplication.isUIThread()) {
				removeLightweightWindowFromStack();
			} else {
				getMainHandler().obtainMessage(MSG_REMOVE_LIGHTWEIGHT).sendToTarget();
			}
		} else {
			super.close(arg);
		}
	}
    private TiAnimator _openingAnim = null;
    private TiAnimator _closingAnim = null;

	@Override
	protected void handleOpen(HashMap options)
	{
		Activity topActivity = TiApplication.getAppCurrentActivity();
		// Don't open if app is closing or closed
		if (topActivity == null || topActivity.isFinishing()) {
			return;
		}
		boolean animated = TiConvert.toBoolean(options, TiC.PROPERTY_ANIMATED, true);
        if (options.containsKey("_anim")) {
            animated = false;
            _openingAnim = animateInternal(options.get("_anim"), null);
        }
		if (lightweight) {
		    addLightweightWindowToStack();
		    handlePostOpen();
		    return;
		}
		
		Intent intent = new Intent(topActivity, TiActivity.class);
		fillIntent(topActivity, intent);

		int windowId = TiActivityWindows.addWindow(this);
		intent.putExtra(TiC.INTENT_PROPERTY_USE_ACTIVITY_WINDOW, true);
		intent.putExtra(TiC.INTENT_PROPERTY_WINDOW_ID, windowId);
		
        int enterAnimation = TiConvert.toInt(options, TiC.PROPERTY_ACTIVITY_ENTER_ANIMATION, -1);
        int exitAnimation = TiConvert.toInt(options, TiC.PROPERTY_ACTIVITY_EXIT_ANIMATION, -1);
        
        
        if (!animated) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION);
            enterAnimation = 0;
            exitAnimation = 0;
        }
		if (enterAnimation != -1 || exitAnimation != -1) {
			topActivity.startActivity(intent);
			topActivity.overridePendingTransition(enterAnimation, exitAnimation);
		} else {
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
	            topActivity.startActivity(intent, createActivityOptionsBundle(topActivity));
	        } else {
	            topActivity.startActivity(intent);
	        }
		}
	}
	
    @Override
    public void animationFinished(TiAnimator animation) {
        super.animationFinished(animation);
        if (_openingAnim == animation) {
            _openingAnim = null;
        }
        if (_closingAnim == animation) {
            _closingAnim = null;
            TiBaseActivity activity = getWindowActivity();
            if (activity != null && !activity.isFinishing()) {
                activity.finish();
                activity.overridePendingTransition(0, 0);
             // Finishing an activity is not synchronous, so we remove the activity from the activity stack here
                TiApplication.removeFromActivityStack(activity);
                windowActivity = null;
            }
        }
    }

	@Override
	protected void handleClose(HashMap options)
	{
        TiBaseActivity activity = getWindowActivity();
		if (parent != null && !(getParent() instanceof DecorViewProxy) && (activity == null || !activity.isFinishing())) {
			//we must have been opened without creating the activity.
			closeFromActivity(true);
			return;
		}
		if (!activity.isFinishing()) {
		    if (options.containsKey("_anim")) {
		        _closingAnim = animateInternal(options.get("_anim"), null);
		        if (_closingAnim != null) {
	                return;
		        }
            }
			if (super.hasActivityTransitions()) {
			    activity.finishAfterTransition();
			} else {
			    activity.finish();
			}
	        
	        int enterAnimation = TiConvert.toInt(options, TiC.PROPERTY_ACTIVITY_ENTER_ANIMATION, -1);
	        int exitAnimation = TiConvert.toInt(options, TiC.PROPERTY_ACTIVITY_EXIT_ANIMATION, -1);
	        boolean animated = TiConvert.toBoolean(options, TiC.PROPERTY_ANIMATED, true);
	        if (!animated) {
	            enterAnimation = 0;
	            exitAnimation = 0;
	        }
	        if (enterAnimation != -1 || exitAnimation != -1) {
	            activity.overridePendingTransition(enterAnimation, exitAnimation);
	        }
			// Finishing an activity is not synchronous, so we remove the activity from the activity stack here
			TiApplication.removeFromActivityStack(activity);
			windowActivity = null;
		}
	}
	
	private Window getWindow() {
	    if (windowActivity != null) {
	        return windowActivity.get().getWindow();
	    }
	    return null;
	}

	@SuppressWarnings("unchecked")
	@Override
	public void windowCreated(TiBaseActivity activity, Bundle savedInstanceState) {
		windowActivity = new WeakReference<TiBaseActivity>(activity);
		activity.setWindowProxy(this);
		setActivity(activity);

		Window win = activity.getWindow();
		// Handle the background of the window activity if it is a translucent activity.
		// If it is a modal window, set a translucent dimmed background to the window.
		// If the opacity is given, set a transparent background to the window. In this case, if no backgroundColor or
		// backgroundImage is given, the window will be completely transparent.
		if (activity instanceof TiTranslucentActivity) {
			win.setBackgroundDrawable(new ColorDrawable(0x00000000));
		}
		
		// Handle activity transitions
		if (LOLLIPOP_OR_GREATER) {
		    applyActivityTransitions(win, properties);
		}

		// Handle the width and height of the window.
		// TODO: If width / height is a percentage value, we can not get the dimension in pixel because
		// the width / height of the decor view is not measured yet at this point. So we can not use the 
		// getAsPixels() method. Maybe we can use WindowManager.getDefaultDisplay.getRectSize(rect) to
		// get the application display dimension.
		if (!lightweight && (hasProperty(TiC.PROPERTY_WIDTH) || hasProperty(TiC.PROPERTY_HEIGHT))) {
			Object width = getProperty(TiC.PROPERTY_WIDTH);
			Object height = getProperty(TiC.PROPERTY_HEIGHT);
			View decorView = win.getDecorView();
			if (decorView != null) {
				int w = LayoutParams.MATCH_PARENT;
				if (width != null) {
					TiDimension dimension = TiConvert.toTiDimension(width, TiDimension.TYPE_WIDTH);
					if (!dimension.isUnitPercent() && !dimension.isUnitFill()) {
						w = dimension.getAsPixels(decorView);
					}
				}
				int h = LayoutParams.MATCH_PARENT;
                if (height != null) {
					TiDimension dimension = TiConvert.toTiDimension(height, TiDimension.TYPE_HEIGHT);
                    if (!dimension.isUnitPercent() && !dimension.isUnitFill()) {
						h = dimension.getAsPixels(decorView);
					}
				}
				win.setLayout(w, h);
			}
		}

		

		// Need to handle the cached activity proxy properties and url window in the JS side.
		callPropertyAsync(PROPERTY_POST_WINDOW_CREATED, null);
	}

	@Override
	public void onWindowActivityCreated()
	{		
        TiBaseActivity activity = getWindowActivity();
		if (parent == null && winManager == null && activity != null) {
			// Fire the open event after setContentView() because getActionBar() need to be called
			// after setContentView(). (TIMOB-14914)
			activity.getActivityProxy().getDecorView().add(this);
			activity.addWindowToStack(this);
		}
		
		handlePostOpen();

		super.onWindowActivityCreated();
	}
	
	@Override
	public void closeFromActivity(boolean activityIsFinishing)
	{
		super.closeFromActivity(activityIsFinishing);
        TiBaseActivity activity = getWindowActivity();
        if (parent == null && winManager == null && activity != null) {
            // Fire the open event after setContentView() because getActionBar() need to be called
            // after setContentView(). (TIMOB-14914)
            ActivityProxy proxy = activity.getActivityProxy();
            if (proxy != null) {
                proxy.getDecorView().remove(this);
            }
            activity.removeWindowFromStack(this);
            windowActivity = null;
        }
	}

	@Override
	protected TiBaseActivity getWindowActivity()
	{
		return (windowActivity != null) ? windowActivity.get() : null;
	}
	
	@Override
	public void setActivity(final Activity activity)
	{
	    if (!TiApplication.isUIThread()) {
	        activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    setActivity(activity);
                }
            });
            return;
        }
		windowActivity = new WeakReference<TiBaseActivity>((TiBaseActivity) activity);
		
		super.setActivity(activity);
		if (activity == null) return;
		if (!hasProperty(TiC.PROPERTY_FULLSCREEN)) {
		    setProperty(TiC.PROPERTY_FULLSCREEN, ((TiBaseActivity) activity).getDefaultFullscreen());
		}
		if (hasProperty(TiC.PROPERTY_TOUCH_ENABLED)) {
			boolean active = TiConvert.toBoolean(getProperty(TiC.PROPERTY_TOUCH_ENABLED), true);
			if (active)
			{
				activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
			}
			else {
				activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
			}
		}
		if (hasProperty(TiC.PROPERTY_TOUCH_PASSTHROUGH)) {
			boolean active = TiConvert.toBoolean(getProperty(TiC.PROPERTY_TOUCH_PASSTHROUGH), true);
			if (active)
			{
				activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
			}
			else {
				activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
			}
		}
		if (hasProperty(TiC.PROPERTY_FOCUSABLE)) {
			boolean active = TiConvert.toBoolean(getProperty(TiC.PROPERTY_FOCUSABLE), true);
			if (active)
			{
				activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
			}
			else {
				activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
			}
		}
	}

	private void fillIntent(Activity activity, Intent intent)
	{
		int windowFlags = 0;
		if (hasProperty(TiC.PROPERTY_WINDOW_FLAGS)) {
			windowFlags = TiConvert.toInt(getProperty(TiC.PROPERTY_WINDOW_FLAGS), 0);
		}
		
		//Set the fullscreen flag
		if (hasProperty(TiC.PROPERTY_FULLSCREEN)) {
			boolean flagVal = TiConvert.toBoolean(getProperty(TiC.PROPERTY_FULLSCREEN), false);
			if (flagVal) {
				windowFlags = windowFlags | WindowManager.LayoutParams.FLAG_FULLSCREEN;
			}
		}
		
		//Set the secure flag
        if (hasProperty("intentFlags")) {
            intent.addFlags(TiConvert.toInt(getProperty("intentFlags"), 0));
        }
		
		//Set the secure flag
		if (hasProperty(TiC.PROPERTY_FLAG_SECURE)) {
			boolean flagVal = TiConvert.toBoolean(getProperty(TiC.PROPERTY_FLAG_SECURE), false);
			if (flagVal) {
				windowFlags = windowFlags | WindowManager.LayoutParams.FLAG_SECURE;
			}
		}
		
		//Stuff flags in intent
		intent.putExtra(TiC.PROPERTY_WINDOW_FLAGS, windowFlags);
		
		if (hasProperty(TiC.PROPERTY_WINDOW_SOFT_INPUT_MODE)) {
			intent.putExtra(TiC.PROPERTY_WINDOW_SOFT_INPUT_MODE, TiConvert.toInt(getProperty(TiC.PROPERTY_WINDOW_SOFT_INPUT_MODE), -1));
		}
		if (hasProperty(TiC.PROPERTY_EXIT_ON_CLOSE)) {
			intent.putExtra(TiC.INTENT_PROPERTY_FINISH_ROOT, TiConvert.toBoolean(getProperty(TiC.PROPERTY_EXIT_ON_CLOSE), false));
		} else {
			intent.putExtra(TiC.INTENT_PROPERTY_FINISH_ROOT, activity.isTaskRoot());
		}
		if (hasProperty(TiC.PROPERTY_NAV_BAR_HIDDEN)) {
			intent.putExtra(TiC.PROPERTY_NAV_BAR_HIDDEN, TiConvert.toBoolean(getProperty(TiC.PROPERTY_NAV_BAR_HIDDEN), false));
		}
		
		if (hasProperty(TiC.PROPERTY_WINDOW_TYPE)) {
            intent.putExtra(TiC.PROPERTY_WINDOW_TYPE, TiConvert.toInt(getProperty(TiC.PROPERTY_WINDOW_TYPE), WindowManager.LayoutParams.TYPE_APPLICATION));
        }

		boolean modal = false;
		if (hasProperty(TiC.PROPERTY_MODAL)) {
			modal = TiConvert.toBoolean(getProperty(TiC.PROPERTY_MODAL), false);

			intent.putExtra(TiC.PROPERTY_MODAL, modal);
		}
		if (modal || hasProperty(TiC.PROPERTY_OPACITY) || (hasProperty(TiC.PROPERTY_BACKGROUND_COLOR) && 
				Color.alpha(TiConvert.toColor(getProperty(TiC.PROPERTY_BACKGROUND_COLOR))) < 255 )) {
			intent.setClass(activity, TiTranslucentActivity.class);
		}
		if (hasProperty(TiC.PROPERTY_WINDOW_PIXEL_FORMAT)) {
			intent.putExtra(TiC.PROPERTY_WINDOW_PIXEL_FORMAT, TiConvert.toInt(getProperty(TiC.PROPERTY_WINDOW_PIXEL_FORMAT), PixelFormat.UNKNOWN));
		}

		// Set the theme property
		if (hasProperty(TiC.PROPERTY_THEME)) {
			String theme = TiConvert.toString(getProperty(TiC.PROPERTY_THEME));
			if (theme != null) {
				try {
					intent.putExtra(TiC.PROPERTY_THEME,
						TiRHelper.getResource("style." + theme.replaceAll("[^A-Za-z0-9_]", "_")));
				} catch (Exception e) {
					Log.w(TAG, "Cannot find the theme: " + theme);
				}
			}
		}
		
		// Set the layoutId property
        if (hasProperty(TiC.PROPERTY_LAYOUT_ID)) {
            String layoutId = TiConvert.toString(getProperty(TiC.PROPERTY_LAYOUT_ID));
            if (layoutId != null) {
                try {
                    intent.putExtra(TiC.PROPERTY_LAYOUT_ID,
                        TiRHelper.getResource("layout." + layoutId.replaceAll("[^A-Za-z0-9_]", "_")));
                } catch (Exception e) {
                    Log.w(TAG, "Cannot find the layoutId: " + layoutId);
                }
            }
        }
		
		// Set the actionBarOverlay property
		if (hasProperty(TiC.PROPERTY_ACTIONBAR_OVERLAY)) {
			boolean overlay = TiConvert.toBoolean(getProperty(TiC.PROPERTY_ACTIONBAR_OVERLAY), false);
			if (overlay){
				intent.putExtra(TiC.PROPERTY_ACTIONBAR_OVERLAY, overlay);
			}
		}
		
		// Set the splitActionBar property
        if (hasProperty(TiC.PROPERTY_SPLIT_ACTIONBAR)) {
            boolean splitActionBar = TiConvert.toBoolean(getProperty(TiC.PROPERTY_SPLIT_ACTIONBAR), false);
            if (splitActionBar){
                intent.putExtra(TiC.PROPERTY_SPLIT_ACTIONBAR, splitActionBar);
            }
        }
	}

//	@Override
//	@Kroll.setProperty(retain=false) @Kroll.method
//	public void setWidth(Object width)
//	{
//		if (isOpenedOrOpening() && !lightweight) {
//			Object current = getProperty(TiC.PROPERTY_WIDTH);
//			if (shouldFireChange(current, width)) {
//				Object height = getProperty(TiC.PROPERTY_HEIGHT);
//				if (TiApplication.isUIThread()) {
//					setWindowWidthHeight(width, height);
//				} else {
//					getMainHandler().obtainMessage(MSG_SET_WIDTH_HEIGHT, new Object[]{width, height}).sendToTarget();
//				}
//			}
//		}
//		super.setWidth(width);
//	}
//
//	@Override
//	@Kroll.setProperty(retain=false) @Kroll.method
//	public void setHeight(Object height)
//	{
//		if (isOpenedOrOpening() && !lightweight) {
//			Object current = getProperty(TiC.PROPERTY_HEIGHT);
//			if (shouldFireChange(current, height)) {
//				Object width = getProperty(TiC.PROPERTY_WIDTH);
//				if (TiApplication.isUIThread()) {
//					setWindowWidthHeight(width, height);
//				} else {
//					getMainHandler().obtainMessage(MSG_SET_WIDTH_HEIGHT, new Object[]{width, height}).sendToTarget();
//				}
//			}
//		}
//		super.setHeight(height);
//	}

	@Override
	public boolean handleMessage(Message msg)
	{
		switch (msg.what) {
			case MSG_SET_PIXEL_FORMAT: {
			    TiBaseActivity activity = getWindowActivity();
                if (activity != null && activity.isCurrentWindow(WindowProxy.this)) {
					Window win = activity.getWindow();
					if (win != null) {
						win.setFormat(TiConvert.toInt((Object)(msg.obj), PixelFormat.UNKNOWN));
						win.getDecorView().invalidate();
					}
				}
				return true;
			}
			case MSG_SET_TITLE: {
				TiBaseActivity activity = getWindowActivity();
                if (activity != null && activity.isCurrentWindow(WindowProxy.this)) {
					activity.setTitle(TiConvert.toString((Object)(msg.obj), ""));
				}
				return true;
			}
//			case MSG_SET_WIDTH_HEIGHT: {
//				Object[] obj = (Object[]) msg.obj;
//				setWindowWidthHeight(obj[0], obj[1]);
//				return true;
//			}
			case MSG_REMOVE_LIGHTWEIGHT: {
				removeLightweightWindowFromStack();
				return true;
			}
		}
		return super.handleMessage(msg);
	}

	private void setWindowWidthHeight(Object width, Object height)
	{
		Activity activity = getWindowActivity();
		if (activity != null) {
			Window win = activity.getWindow();
			if (win != null) {
				View decorView = win.getDecorView();
				if (decorView != null) {
					int w = LayoutParams.MATCH_PARENT;
					if (!(width == null || width.equals(TiC.LAYOUT_FILL))) {
						TiDimension wDimension = TiConvert.toTiDimension(width, TiDimension.TYPE_WIDTH);
						if (!wDimension.isUnitPercent()) {
							w = wDimension.getAsPixels(decorView);
						}
					}
					int h = LayoutParams.MATCH_PARENT;
					if (!(height == null || height.equals(TiC.LAYOUT_FILL))) {
						TiDimension hDimension = TiConvert.toTiDimension(height, TiDimension.TYPE_HEIGHT);
						if (!hDimension.isUnitPercent()) {
							h = hDimension.getAsPixels(decorView);
						}
					}
					win.setLayout(w, h);
				}
			}
		}
	}
	
	/**
	 * Helper method to apply activity transitions.
	 * @param win The window holding the activity.
	 * @param props The property dictionary. 
	 */
	private void applyActivityTransitions(Window win, KrollDict props) {
	    if (LOLLIPOP_OR_GREATER) {
	        // Return and reenter transitions defaults to enter and exit transitions respectively only if they are not set.
	        // And setting a null transition makes the view unaccounted from transition. 
	        if (props.containsKeyAndNotNull(TiC.PROPERTY_ENTER_TRANSITION)) {
	            win.setEnterTransition(createTransition(props, TiC.PROPERTY_ENTER_TRANSITION));
	        } 

	        if (props.containsKeyAndNotNull(TiC.PROPERTY_EXIT_TRANSITION)) {
	            win.setExitTransition(createTransition(props, TiC.PROPERTY_EXIT_TRANSITION));
	        }

	        if (props.containsKeyAndNotNull(TiC.PROPERTY_RETURN_TRANSITION)) {
	            win.setReturnTransition(createTransition(props, TiC.PROPERTY_RETURN_TRANSITION));
	        }

	        if (props.containsKeyAndNotNull(TiC.PROPERTY_REENTER_TRANSITION)) {
	            win.setReenterTransition(createTransition(props, TiC.PROPERTY_REENTER_TRANSITION));
	        }

	        if (props.containsKeyAndNotNull(TiC.PROPERTY_SHARED_ELEMENT_ENTER_TRANSITION)) { 
	            win.setSharedElementEnterTransition(createTransition(props, TiC.PROPERTY_SHARED_ELEMENT_ENTER_TRANSITION));
	        }

	        if (props.containsKeyAndNotNull(TiC.PROPERTY_SHARED_ELEMENT_EXIT_TRANSITION)) {
	            win.setSharedElementExitTransition(createTransition(props, TiC.PROPERTY_SHARED_ELEMENT_EXIT_TRANSITION));
	        }

	        if (props.containsKeyAndNotNull(TiC.PROPERTY_SHARED_ELEMENT_REENTER_TRANSITION)) { 
	            win.setSharedElementReenterTransition(createTransition(props, TiC.PROPERTY_SHARED_ELEMENT_REENTER_TRANSITION));
	        }

	        if (props.containsKeyAndNotNull(TiC.PROPERTY_SHARED_ELEMENT_RETURN_TRANSITION)) { 
	            win.setSharedElementReturnTransition(createTransition(props, TiC.PROPERTY_SHARED_ELEMENT_RETURN_TRANSITION));
	        }
	    } 
	}

	/**
	 * Creates a transition for the supplied transition type. 
	 * @param props The property dictionary.
	 * @param key The transition type
	 * @return A Transition or null if UIModule.TRANSITION_NONE or unknown transition is specified. 
	 */
	@SuppressLint({ "InlinedApi", "RtlHardcoded" })
	@Nullable
	private Transition createTransition(KrollDict props, String key) {
		if (LOLLIPOP_OR_GREATER) {
			Transition t = null;
			final int transitionType = props.getInt(key);
			switch (transitionType) {
    			case TiUIView.TRANSITION_EXPLODE:
    				t = new Explode();
    				break;
    
    			case TiUIView.TRANSITION_FADE_IN:
    				t = new Fade(Fade.IN);
    				break;
    				
    			case TiUIView.TRANSITION_FADE_OUT:
    				t = new Fade(Fade.OUT);
    				break;
    
    			case TiUIView.TRANSITION_SLIDE_TOP:
    				t = new Slide(Gravity.TOP);
    				break;
    
    			case TiUIView.TRANSITION_SLIDE_RIGHT:
    				t = new Slide(Gravity.RIGHT);
    				break;
    
    			case TiUIView.TRANSITION_SLIDE_BOTTOM:
    				t = new Slide(Gravity.BOTTOM);
    				break;
    
    			case TiUIView.TRANSITION_SLIDE_LEFT:
    				t = new Slide(Gravity.LEFT);
    				break;
    
    			case TiUIView.TRANSITION_CHANGE_BOUNDS:
    				t = new ChangeBounds();
    				break;
    				
    			case TiUIView.TRANSITION_CHANGE_CLIP_BOUNDS:
    				t = new ChangeClipBounds();
    				break;
    				
    			case TiUIView.TRANSITION_CHANGE_TRANSFORM:
    				t = new ChangeTransform();
    				break;
    
    			case TiUIView.TRANSITION_CHANGE_IMAGE_TRANSFORM:
    				t = new ChangeImageTransform();
    				break;
    
    			default:
    				break;
			}
			return t;
		} else {
			return null;
		}
	}
	

	@Kroll.method(name = "_isLightweight")
	public boolean isLightweight()
	{
		// We know whether a window is lightweight or not only after it opens.
		return (isOpenedOrOpening() && lightweight);
	}

	@Override
	public String getApiName()
	{
		return "Ti.UI.Window";
	}

    @Kroll.method()
    public void closeWindowsInFront()
    {
        TiBaseActivity activity = getWindowActivity();
        if (activity != null) {
            activity.closeFrontActivities();
//            activity.closeStackWindowsInFrontOf(this);
        }
    }
}
