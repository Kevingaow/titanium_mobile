/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2009-2016 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */
package ti.modules.titanium.geolocation;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;

import org.appcelerator.kroll.KrollDict;
import org.appcelerator.kroll.KrollFunction;
import org.appcelerator.kroll.KrollModule;
import org.appcelerator.kroll.KrollProxy;
import org.appcelerator.kroll.annotations.Kroll;
import org.appcelerator.kroll.common.AsyncResult;
import org.appcelerator.kroll.common.Log;
import org.appcelerator.kroll.common.TiMessenger.CommandNoReturn;
import org.appcelerator.titanium.TiApplication;
import org.appcelerator.titanium.TiBaseActivity;
import org.appcelerator.titanium.TiC;
import org.appcelerator.titanium.util.TiConvert;

import ti.modules.titanium.geolocation.TiLocation.GeocodeResponseHandler;
import ti.modules.titanium.geolocation.android.AndroidModule;
import ti.modules.titanium.geolocation.android.LocationProviderProxy;
import ti.modules.titanium.geolocation.android.LocationProviderProxy.LocationProviderListener;
import ti.modules.titanium.geolocation.android.LocationRuleProxy;
import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.location.LocationProvider;
import android.os.Build;
import android.os.Handler;
import android.os.Message;

/**
 * GeolocationModule exposes all common methods and properties relating to geolocation behavior
 * associated with Ti.Geolocation to the Titanium developer.  Only cross platform API points should
 * be exposed through this class as Android-only API points or types should be put in a Android module
 * under this module.
 *
 * The GeolocationModule provides management for 3 different location behavior modes (detailed
 * descriptions will follow below):
 * <ul>
 * 	<li>legacy - existing behavior found in Titanium Mobile 1.7 and 1.8. <b>DEPRECATED</b></li>
 * 	<li>simple - replacement for the old legacy mode that allows for better parity across platforms</li>
 * 	<li>manual - Android-specific mode that exposes full control over the providers and rules</li>
 * </ul>
 *
 * <p>
 * <b>Legacy location mode</b>:<br>
 * This mode operates on receiving location updates from a single active provider at a time.  Settings
 * used to pick and register a provider with the OS are pulled from the PROPERTY_ACCURACY, PROPERTY_FREQUENCY
 * and PROPERTY_PREFERRED_PROVIDER properties on the module.
 * <p>
 * The valid accuracy properties for this location mode are ACCURACY_BEST, ACCURACY_NEAREST_TEN_METERS,
 * ACCURACY_HUNDRED_METERS, ACCURACY_KILOMETER and ACCURACY_THREE_KILOMETERS.  The accuracy property is a
 * double value that will be used by the OS as a way to determine how many meters should change in location
 * before a new update is sent.  Accuracy properties other than this will either be ignored or change the
 * current location behavior mode.  The frequency property is a double value that is used by the OS to determine
 * how much time in milliseconds should pass before a new update is sent.
 * <p>
 * The OS uses some fuzzy logic to determine the update frequency and these values are treated as no more than
 * suggestions.  For example:  setting the frequency to 0 milliseconds and the accuracy to 10 meters may not
 * result in a update being sent as fast as possible which is what frequency of 0 ms indicates.  This is due to
 * the OS not sending updates till the accuracy property is satisfied.  If the desired behavior is to get updates
 * purely based on time then the suggested mechanism would be to set the accuracy to 0 meters and then set the
 * frequency to the desired update interval in milliseconds.
 *
 * <p>
 * <b>Simple location mode</b>:<br>
 * This mode operates on receiving location updates from multiple sources.  The simple mode has two states - high
 * accuracy and low accuracy.  The difference in these two modes is that low accuracy has the passive and network
 * providers registered by default where the high accuracy state enables the gps provider in addition to the passive
 * and network providers.  The simple mode utilizes location rules for filtering location updates to try and fall back
 * gracefully (when in high accuracy state) to the network and passive providers if a gps update has not been received
 * recently.
 * <p>
 * No specific controls for time or distance (better terminology in line with native Android docs but these
 * are called frequency and accuracy in legacy mode) are exposed to the Titanium developer as the details of this mode
 * are supposed to be driven by Appcelerator based on our observations.  If greater control on the part of the Titanium
 * developer is needed then the manual behavior mode can and should be used.
 *
 * <p>
 * <b>Manual location mode</b>:<br>
 * This mode puts full control over providers and rules in the hands of the Titanium developer.  The developer will be
 * responsible for registering location providers, setting time and distance settings per provider and defining the rule
 * set if any rules are desired.
 * <p>
 * In this mode, the developer would create a Ti.Geolocation.Android.LocationProvider object for each provider they want
 * to use and add this to the list of manual providers via addLocationProvider(LocationProviderProxy).  In order to set
 * rules, the developer will have to create a Ti.Geolocation.Android.LocationRule object per rule and then add those
 * rules via addLocationRule(LocationRuleProxy).  These rules will be applied to any location updates that come from the
 * registered providers.  Further information on the LocationProvider and LocationRule objects can be found by looking at
 * those specific classes.
 *
 * <p>
 * <b>General location behavior</b>:<br>
 * The GeolocationModule is capable of switching modes at any time and keeping settings per mode separated.  Changing modes
 * is done by updating the Ti.Geolocation.accuracy property. Based on the new value of the accuracy property, the
 * legacy or simple modes may be enabled (and the previous mode may be turned off).  Enabling or disabling the manual mode
 * is done by setting the AndroidModule.manualMode (Ti.Geolocation.Android.manualMode) value.  NOTE:  updating the location
 * rules will not update the mode.  Simply setting the Ti.Geolocation.accuracy property will not enable the legacy/simple
 * modes if you are currently in the manual mode - you must disable the manual mode before the simple/legacy modes are used
 * <p>
 * In regards to actually "turning on" the providers by registering them with the OS - this is triggered by the presence of
 * "location" event listeners on the GeolocationModule.  When the first listener is added, providers start being registered
 * with the OS.  When there are no listeners then all the providers are de-registered.  Changes made to location providers or
 * accuracy, frequency properties or even changing modes are respected and kept but don't actually get applied on the OS until
 * the listener count is greater than 0.
 */
// TODO deprecate the frequency and preferredProvider property
@Kroll.module(propertyAccessors={
	TiC.PROPERTY_ACCURACY,
	TiC.PROPERTY_FREQUENCY,
	TiC.PROPERTY_PREFERRED_PROVIDER
})
public class GeolocationModule extends KrollModule
	implements Handler.Callback, LocationProviderListener
{
	// TODO move these to the AndroidModule namespace since they will only be used when creating
	// manual location providers
	@Kroll.constant @Deprecated public static final String PROVIDER_PASSIVE = LocationManager.PASSIVE_PROVIDER;
	@Kroll.constant @Deprecated public static final String PROVIDER_NETWORK = LocationManager.NETWORK_PROVIDER;
	@Kroll.constant @Deprecated public static final String PROVIDER_GPS = LocationManager.GPS_PROVIDER;

	@Kroll.constant public static final int ACCURACY_LOW = 0;
	@Kroll.constant public static final int ACCURACY_HIGH = 1;
	@Kroll.constant @Deprecated public static final int ACCURACY_BEST = 2;
	@Kroll.constant @Deprecated public static final int ACCURACY_NEAREST_TEN_METERS = 3;
	@Kroll.constant @Deprecated public static final int ACCURACY_HUNDRED_METERS = 4;
	@Kroll.constant @Deprecated public static final int ACCURACY_KILOMETER = 5;
	@Kroll.constant @Deprecated public static final int ACCURACY_THREE_KILOMETERS = 6;

	public TiLocation tiLocation;
	public AndroidModule androidModule;
	public int numLocationListeners = 0;
    public KrollFunction singleLocationCallback = null;
    public boolean destroyed = false;
	public HashMap<String, LocationProviderProxy> simpleLocationProviders = new HashMap<String, LocationProviderProxy>();
	@Deprecated public HashMap<String, LocationProviderProxy> legacyLocationProviders = new HashMap<String, LocationProviderProxy>();
	public boolean legacyModeActive = true;

	protected static final int MSG_ENABLE_LOCATION_PROVIDERS = KrollModule.MSG_LAST_ID + 100;
	protected static final int MSG_DISABLE_LOCATION_PROVIDERS = KrollModule.MSG_LAST_ID + 101;
	protected static final int MSG_LAST_ID = MSG_DISABLE_LOCATION_PROVIDERS;

	private static final String TAG = "GeolocationModule";
	private static final double SIMPLE_LOCATION_PASSIVE_DISTANCE = 0.0;
	private static final double SIMPLE_LOCATION_PASSIVE_TIME = 0;
	private static final double SIMPLE_LOCATION_NETWORK_DISTANCE = 10.0;
	private static final double SIMPLE_LOCATION_NETWORK_TIME = 10000;
	private static final double SIMPLE_LOCATION_GPS_DISTANCE = 3.0;
	private static final double SIMPLE_LOCATION_GPS_TIME = 3000;
	private static final double SIMPLE_LOCATION_NETWORK_DISTANCE_RULE = 200;
	private static final double SIMPLE_LOCATION_NETWORK_MIN_AGE_RULE = 60000;
	public static final double SIMPLE_LOCATION_NETWORK_MIN_DISTANCE_RULE = 0.0001;
	private static final double SIMPLE_LOCATION_GPS_MIN_AGE_RULE = 30000;


	private TiCompass tiCompass;
	private boolean compassListenersRegistered = false;
	private boolean sentAnalytics = false;
	private ArrayList<LocationRuleProxy> simpleLocationRules = new ArrayList<LocationRuleProxy>();
	private LocationRuleProxy simpleLocationGpsRule;
	private LocationRuleProxy simpleLocationNetworkRule;
	private int simpleLocationAccuracyProperty = ACCURACY_LOW;
	private Location lastRulesCheckedLocation;
	//currentLocation is conditionally updated. lastLocation is unconditionally updated
	//since currentLocation determines when to send out updates, and lastLocation is passive
	private Location lastLocation;
	@Deprecated private HashMap<Integer, Double> legacyLocationAccuracyMap = new HashMap<Integer, Double>();
	@Deprecated private int legacyLocationAccuracyProperty = ACCURACY_NEAREST_TEN_METERS;
	@Deprecated private double legacyLocationFrequency = 5000;
	@Deprecated private String legacyLocationPreferredProvider = PROVIDER_NETWORK;

    private boolean currentlyEnabled = false;
    private boolean listeningForChanges = false;
    public class LocationProviderChangedReceiver extends BroadcastReceiver {
        private final static String TAG = "LocationProviderChangedReceiver";

        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent.getAction()
                    .matches("android.location.PROVIDERS_CHANGED")) {
                boolean oldState = currentlyEnabled;
                getAndUpdateServicesEnabled();
                if (oldState == currentlyEnabled) {
                    return;
                }
                Log.i(TAG, "Location Providers changed");
                KrollDict data = new KrollDict();
                data.put(TiC.PROPERTY_ENABLED, currentlyEnabled);
                data.put("hasPermissions", hasLocationPermissions());
                fireEvent(TiC.EVENT_CHANGE, data);
            }
        }
    }

	/**
	 * Constructor
	 */
	public GeolocationModule()
	{
		super("geolocation");
		
		tiLocation = new TiLocation();
		tiCompass = new TiCompass(this, tiLocation);

		// initialize the legacy location accuracy map
		legacyLocationAccuracyMap.put(ACCURACY_BEST, 0.0); // this needs to be 0.0 to work for only time based updates
		legacyLocationAccuracyMap.put(ACCURACY_NEAREST_TEN_METERS, 10.0);
		legacyLocationAccuracyMap.put(ACCURACY_HUNDRED_METERS, 100.0);
		legacyLocationAccuracyMap.put(ACCURACY_KILOMETER, 1000.0);
		legacyLocationAccuracyMap.put(ACCURACY_THREE_KILOMETERS, 3000.0);

		legacyLocationProviders.put(PROVIDER_NETWORK, new LocationProviderProxy(PROVIDER_NETWORK, 10.0f, legacyLocationFrequency, this));

		simpleLocationProviders.put(PROVIDER_NETWORK, new LocationProviderProxy(PROVIDER_NETWORK, SIMPLE_LOCATION_NETWORK_DISTANCE, SIMPLE_LOCATION_NETWORK_TIME, this));
		simpleLocationProviders.put(PROVIDER_PASSIVE, new LocationProviderProxy(PROVIDER_PASSIVE, SIMPLE_LOCATION_PASSIVE_DISTANCE, SIMPLE_LOCATION_PASSIVE_TIME, this));

		// create these now but we don't want to include these in the rule set unless the simple GPS provider is enabled
		simpleLocationNetworkRule = new LocationRuleProxy(PROVIDER_NETWORK, SIMPLE_LOCATION_NETWORK_DISTANCE_RULE, SIMPLE_LOCATION_NETWORK_MIN_AGE_RULE, null, SIMPLE_LOCATION_NETWORK_MIN_DISTANCE_RULE, null);
		simpleLocationGpsRule = new LocationRuleProxy(PROVIDER_GPS, null, SIMPLE_LOCATION_GPS_MIN_AGE_RULE, null, null, null);
	}

	@Override
	public void onAppTerminate(TiApplication app)
	{
		tiCompass.unregisterListener();
		disableLocationProviders();
	}
	
	/**
	 * @see org.appcelerator.kroll.KrollProxy#handleMessage(android.os.Message)
	 */
	@Override
	public boolean handleMessage(Message message)
	{
		switch (message.what) {
//			case MSG_ENABLE_LOCATION_PROVIDERS: {
//				Object locationProviders = message.obj;
//				doEnableLocationProviders((HashMap<String, LocationProviderProxy>) locationProviders);
//
//				return true;
//			}
			case MSG_DISABLE_LOCATION_PROVIDERS: {
				doDisableLocationProviders();
                ((AsyncResult) message.obj).setResult(null);
				return true;
			}
		}

		return super.handleMessage(message);
	}

	private void doAnalytics(Location location)
	{
        if (!TiApplication.getInstance().isAnalyticsEnabled()) return;
		if (!sentAnalytics) {
			tiLocation.doAnalytics(location);
			sentAnalytics = true;
		}
	}

	/**
	 * Called by a registered location provider when a location update is received
	 *
	 * @param location			location update that was received
	 *
	 * @see ti.modules.titanium.geolocation.android.LocationProviderProxy.LocationProviderListener#onLocationChanged(android.location.Location)
	 */
	public void onLocationChanged(Location location)
	{
		if (shouldUseUpdate(location)) {
            HashMap event = buildLocationEvent(location, tiLocation.locationManager.getProvider(location.getProvider()));
			fireEvent(TiC.EVENT_LOCATION, event, false, false);
			lastRulesCheckedLocation = location;
			doAnalytics(location);
			if (singleLocationCallback != null) {
	            singleLocationCallback.call(this.getKrollObject(), new Object[] {
	                    event
	                });
	            singleLocationCallback = null;
	            if (numLocationListeners == 0) {
	                disableLocationProviders();
	            }
	        }
		}
        lastLocation = location;
        
	}

	/**
	 * Called by a registered location provider when its state changes
	 *
	 * @param providerName		name of the provider whose state has changed
	 * @param state				new state of the provider
	 *
	 * @see ti.modules.titanium.geolocation.android.LocationProviderProxy.LocationProviderListener#onProviderStateChanged(java.lang.String, int)
	 */
	public void onProviderStateChanged(String providerName, int state)
	{
		String message = providerName;

		// TODO this is trash.  deprecate the existing mechanism of bundling status updates with the
		// location event and create a new "locationState" (or whatever) event.  for the time being,
		// this solution kills my soul slightly less than the previous one
		switch (state) {
			case LocationProviderProxy.STATE_DISABLED:
				message += " is disabled";
				fireEvent(TiC.EVENT_LOCATION, buildLocationErrorEvent(state, message));
				break;

			case LocationProviderProxy.STATE_ENABLED:
				message += " is enabled";
				break;

			case LocationProviderProxy.STATE_OUT_OF_SERVICE:
				message += " is out of service";
				fireEvent(TiC.EVENT_LOCATION, buildLocationErrorEvent(state, message));
				break;

			case LocationProviderProxy.STATE_UNAVAILABLE:
				message += " is unavailable";
				fireEvent(TiC.EVENT_LOCATION, buildLocationErrorEvent(state, message));
				break;

			case LocationProviderProxy.STATE_AVAILABLE:
				message += " is available";
				break;

			case LocationProviderProxy.STATE_UNKNOWN:
				message += " is in a unknown state [" + state + "]";
				fireEvent(TiC.EVENT_LOCATION, buildLocationErrorEvent(state, message));
				break;

			default:
				message += " is in a unknown state [" + state + "]";
				fireEvent(TiC.EVENT_LOCATION, buildLocationErrorEvent(state, message));
				break;
		}
        Log.d(TAG, message, Log.DEBUG_MODE);
	}

	/**
	 * Called when the location provider has had one of it's properties updated and thus needs to be re-registered with the OS
	 *
	 * @param locationProvider		the location provider that needs to be re-registered
	 *
	 * @see ti.modules.titanium.geolocation.android.LocationProviderProxy.LocationProviderListener#onProviderUpdated(ti.modules.titanium.geolocation.android.LocationProviderProxy)
	 */
	public void onProviderUpdated(LocationProviderProxy locationProvider)
	{
		if (getManualMode() && (numLocationListeners > 0)) {
			tiLocation.locationManager.removeUpdates(locationProvider);
			registerLocationProvider(locationProvider);
		}
	}

	/**
	 * @see org.appcelerator.kroll.KrollModule#propertyChanged(java.lang.String, java.lang.Object, java.lang.Object, org.appcelerator.kroll.KrollProxy)
	 */
	@Override
	public void propertyChanged(String key, Object oldValue, Object newValue, KrollProxy proxy)
	{
		if (key.equals(TiC.PROPERTY_ACCURACY)) {
			// accuracy property is what triggers a shift between simple and legacy modes. the
			// android only manual mode is indicated by the AndroidModule.manualMode value which
			// has no impact on the legacyModeActive flag.  IE: when determining the current mode,
			// both flags must be checked
			propertyChangedAccuracy(newValue);

		} else if (key.equals(TiC.PROPERTY_FREQUENCY)) {
			propertyChangedFrequency(newValue);

		} else if (key.equals(TiC.PROPERTY_PREFERRED_PROVIDER)) {
			propertyChangedPreferredProvider(newValue);
		}
	}

	/**
	 * Handles property change for Ti.Geolocation.accuracy
	 *
	 * @param newValue					new accuracy value
	 */
	private void propertyChangedAccuracy(Object newValue)
	{
		// is legacy mode enabled (registered with OS, not just selected via the accuracy property)
		boolean legacyModeEnabled = false;
		if (legacyModeActive && (!getManualMode()) && (numLocationListeners > 0)) {
			legacyModeEnabled = true;
		}

		// is simple mode enabled (registered with OS, not just selected via the accuracy property)
		boolean simpleModeEnabled = false;
		if (!legacyModeActive && !(getManualMode()) && (numLocationListeners > 0)) {
			simpleModeEnabled = true;
		}

		int accuracyProperty = TiConvert.toInt(newValue);

		// is this a legacy accuracy property?
		Double accuracyLookupResult = legacyLocationAccuracyMap.get(accuracyProperty);
		if (accuracyLookupResult != null) {
			// has the value changed from the last known good value?
			if (accuracyProperty != legacyLocationAccuracyProperty) {
				legacyLocationAccuracyProperty = accuracyProperty;

				for (String providerKey : legacyLocationProviders.keySet()) {
					LocationProviderProxy locationProvider = legacyLocationProviders.get(providerKey);
					locationProvider.setProperty(TiC.PROPERTY_MIN_UPDATE_DISTANCE, accuracyLookupResult);
				}

				if (legacyModeEnabled) {
					enableLocationProviders(legacyLocationProviders);
				}
			}

			if (simpleModeEnabled) {
				enableLocationProviders(legacyLocationProviders);
			}

			legacyModeActive = true;

		// is this a simple accuracy property?
		} else if ((accuracyProperty == ACCURACY_HIGH) || (accuracyProperty == ACCURACY_LOW)) {
			// has the value changed from the last known good value?
			if (accuracyProperty != simpleLocationAccuracyProperty) {
				simpleLocationAccuracyProperty = accuracyProperty;
				LocationProviderProxy gpsProvider = simpleLocationProviders.get(PROVIDER_GPS);

				if ((accuracyProperty == ACCURACY_HIGH) && (gpsProvider == null)) {
					gpsProvider = new LocationProviderProxy(PROVIDER_GPS, SIMPLE_LOCATION_GPS_DISTANCE, SIMPLE_LOCATION_GPS_TIME, this);
					simpleLocationProviders.put(PROVIDER_GPS, gpsProvider);
					simpleLocationRules.add(simpleLocationNetworkRule);
					simpleLocationRules.add(simpleLocationGpsRule);

					if (simpleModeEnabled) {
						registerLocationProvider(gpsProvider);
					}

				} else if ((accuracyProperty == ACCURACY_LOW) && (gpsProvider != null)) {
					simpleLocationProviders.remove(PROVIDER_GPS);
					simpleLocationRules.remove(simpleLocationNetworkRule);
					simpleLocationRules.remove(simpleLocationGpsRule);

					if (simpleModeEnabled) {
						tiLocation.locationManager.removeUpdates(gpsProvider);
					}
				}
			}

			if (legacyModeEnabled) {
				enableLocationProviders(simpleLocationProviders);
			}

			legacyModeActive = false;
		}
	}

	/**
	 * Handles property change for Ti.Geolocation.frequency
	 *
	 * @param newValue					new frequency value
	 */
	private void propertyChangedFrequency(Object newValue)
	{
		// is legacy mode enabled (registered with OS, not just selected via the accuracy property)
		boolean legacyModeEnabled = false;
		if (legacyModeActive && !getManualMode() && (numLocationListeners > 0)) {
			legacyModeEnabled = true;
		}

		double frequencyProperty = TiConvert.toDouble(newValue) * 1000;
		if (frequencyProperty != legacyLocationFrequency) {
			legacyLocationFrequency = frequencyProperty;

			Iterator<String> iterator = legacyLocationProviders.keySet().iterator();
			while(iterator.hasNext()) {
				LocationProviderProxy locationProvider = legacyLocationProviders.get(iterator.next());
				locationProvider.setProperty(TiC.PROPERTY_MIN_UPDATE_TIME, legacyLocationFrequency);
			}

			if (legacyModeEnabled) {
				enableLocationProviders(legacyLocationProviders);
			}
		}
	}

	/**
	 * Handles property change for Ti.Geolocation.preferredProvider
	 *
	 * @param newValue					new preferredProvider value
	 */
	private void propertyChangedPreferredProvider(Object newValue)
	{
		// is legacy mode enabled (registered with OS, not just selected via the accuracy property)
		boolean legacyModeEnabled = false;
		if (legacyModeActive && !getManualMode() && (numLocationListeners > 0)) {
			legacyModeEnabled = true;
		}

		String preferredProviderProperty = TiConvert.toString(newValue);
		if (!(preferredProviderProperty.equals(PROVIDER_NETWORK)) && (!(preferredProviderProperty.equals(PROVIDER_GPS)))) {
			return;
		}

		if (!(preferredProviderProperty.equals(legacyLocationPreferredProvider))) {
			LocationProviderProxy oldProvider = legacyLocationProviders.get(legacyLocationPreferredProvider);
			LocationProviderProxy newProvider = legacyLocationProviders.get(preferredProviderProperty);

			if (oldProvider != null) {
				legacyLocationProviders.remove(legacyLocationPreferredProvider);

				if (legacyModeEnabled) {
					tiLocation.locationManager.removeUpdates(oldProvider);
				}
			}

			if (newProvider == null) {
				newProvider = new LocationProviderProxy(preferredProviderProperty, legacyLocationAccuracyMap.get(legacyLocationAccuracyProperty), legacyLocationFrequency, this);
				legacyLocationProviders.put(preferredProviderProperty, newProvider);

				if (legacyModeEnabled) {
					registerLocationProvider(newProvider);
				}
			}

			legacyLocationPreferredProvider = preferredProviderProperty;
		}
	}
	
//	private GpsStatus.Listener mStatusListener = null;
	private LocationProviderChangedReceiver mStatusReceiver = null;
    private boolean shouldFireStateChange = true;
	/**
	 * @see org.appcelerator.kroll.KrollProxy#eventListenerAdded(java.lang.String, int, org.appcelerator.kroll.KrollProxy)
	 */
	@Override
	protected void eventListenerAdded(String event, int count, KrollProxy proxy)
	{
		if (TiC.EVENT_CHANGE.equals(event)) {
		    if (mStatusReceiver == null) {
		        //make sure we set listeningForChanges after currentlyEnabled!
		        //or it wont check its state
		        currentlyEnabled = getAndUpdateServicesEnabled();
                listeningForChanges = true;
		        mStatusReceiver = new LocationProviderChangedReceiver();
	            getActivity().registerReceiver(mStatusReceiver, new IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION));
		    }
//			if (mStatusListener == null) {
//			    mStatusListener = new android.location.GpsStatus.Listener()
//			    {
//			        public void onGpsStatusChanged(int event)
//			        {
//			            switch(event)
//			            {
//			            case GpsStatus.GPS_EVENT_STARTED:
//			            case GpsStatus.GPS_EVENT_STOPPED:
//			                KrollDict data = new KrollDict();
//			                data.put(TiC.PROPERTY_ENABLED, event == GpsStatus.GPS_EVENT_STARTED);
//			                data.put("hasPermissions", hasLocationPermissions());
//	                        fireEvent(TiC.EVENT_CHANGE, data);
//			                break;
//			            }
//			        }
//			    };
//			    tiLocation.locationManager.addGpsStatusListener(mStatusListener);
//			}

		} else if (TiC.EVENT_HEADING.equals(event)) {
            if (!compassListenersRegistered) {
                tiCompass.registerListener();
                compassListenersRegistered = true;
            }

        } else if (TiC.EVENT_LOCATION.equals(event)) {
			numLocationListeners++;
			if (numLocationListeners == 1 && singleLocationCallback == null) {
	            runInUiThread(new CommandNoReturn() {
	                @Override
	                public void execute() {
	                    if (enableLocationProviders()) {
	                        // fire off an initial location fix if one is available
	                        Log.d(TAG, "firing last location known check");
	                        onLocationChanged(tiLocation.getLastKnownLocation());
	                    }
	                }
	            }, true); 
			}
		}

		super.eventListenerAdded(event, count, proxy);
	}

	/**
	 * @see org.appcelerator.kroll.KrollProxy#eventListenerRemoved(java.lang.String, int, org.appcelerator.kroll.KrollProxy)
	 */
	@Override
	protected void eventListenerRemoved(String event, int count, KrollProxy proxy)
	{
	    if (TiC.EVENT_CHANGE.equals(event)) {
	        if (mStatusReceiver != null) {
	            listeningForChanges = false;
                getActivity().unregisterReceiver(mStatusReceiver);
                mStatusReceiver = null;
            }
//            if (mStatusListener != null) {
//                tiLocation.locationManager.removeGpsStatusListener(mStatusListener);
//                mStatusListener = null;
//            }

        } else if (TiC.EVENT_HEADING.equals(event)) {
			if (compassListenersRegistered) {
				tiCompass.unregisterListener();
				compassListenersRegistered = false;
			}

		} else if (TiC.EVENT_LOCATION.equals(event)) {
			numLocationListeners--;
			if (numLocationListeners == 0 && singleLocationCallback == null) {
				disableLocationProviders();
			}
		}

		super.eventListenerRemoved(event, count, proxy);
	}

	/**
	 * Checks if the device has a compass sensor
	 *
	 * @return			<code>true</code> if the device has a compass, <code>false</code> if not
	 */
	@Kroll.method @Kroll.getProperty
	public boolean getHasCompass()
	{
		return tiCompass.getHasCompass();
	}

	/**
	 * Retrieves the current compass heading and returns it to the specified Javascript function
	 *
	 * @param listener			Javascript function that will be invoked with the compass heading
	 */
	@Kroll.method
	public void getCurrentHeading(final KrollFunction listener)
	{
		tiCompass.getCurrentHeading(listener);
	}

	/**
	 * Retrieves the last obtained location and returns it as JSON.
	 * 
	 * @return			JSON representing the last geolocation event
	 */
	@Kroll.method @Kroll.getProperty
	public KrollDict getLastGeolocation()
	{
	    if (lastLocation == null) {
	        lastLocation = tiLocation.getLastKnownLocation();
	    }
	    if (lastLocation != null) {
	        return buildLocationEvent(lastLocation, tiLocation.locationManager.getProvider(lastLocation.getProvider()));
	    }
	    return null;
	}

	/**
	 * Checks if the Android manual location behavior mode is currently enabled
	 *
	 * @return 				<code>true</code> if currently in manual mode, <code>
	 * 						false</code> if the Android module has not been registered
	 * 						yet with the OS or manual mode is not enabled
	 */
	private boolean getManualMode()
	{
		if (androidModule == null) {
			return false;

		} else {
			return androidModule.manualMode;
		}
	}

	@Kroll.method
	public boolean hasLocationPermissions()
	{
		if (Build.VERSION.SDK_INT < 23) {
			return true;
		}
		Context context = TiApplication.getInstance().getApplicationContext();
		if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
			return true;
		}
		return false;
	}

	@Kroll.method
	public void requestLocationPermissions(@Kroll.argument(optional=true) Object type, @Kroll.argument(optional=true) KrollFunction permissionCallback)
	{
		if (hasLocationPermissions()) {
		    if (permissionCallback != null) {
                KrollDict response = new KrollDict();
                response.putCodeAndMessage(0, null);
                permissionCallback.callAsync(getKrollObject(), response);
            }
			return;
		}

		TiBaseActivity.addPermissionListener(TiC.PERMISSION_CODE_LOCATION, getKrollObject(), (KrollFunction) ((type instanceof KrollFunction && permissionCallback == null)?type:permissionCallback));
        Activity currentActivity  = TiApplication.getInstance().getCurrentActivity();
        if (currentActivity != null) {
            currentActivity.requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, TiC.PERMISSION_CODE_LOCATION);       
        }
	}

	/**
	 * Registers the specified location provider with the OS.  Once the provider is registered, the OS
	 * will begin to provider location updates as they are available
	 *
	 * @param locationProvider			location provider to be registered
	 */
	public void registerLocationProvider(LocationProviderProxy locationProvider)
	{
		if (!hasLocationPermissions()) {
			Log.e(TAG, "Location permissions missing", Log.DEBUG_MODE);
			return;
		}
		String provider = TiConvert.toString(locationProvider.getProperty(TiC.PROPERTY_NAME));

		try {
			tiLocation.locationManager.requestLocationUpdates(
					provider,
					(long) locationProvider.getMinUpdateTime(),
					(float) locationProvider.getMinUpdateDistance(),
					locationProvider);

		} catch (IllegalArgumentException e) {
			Log.e(TAG, "Unable to register [" + provider + "], provider is null");

		} catch (SecurityException e) {
			Log.e(TAG, "Unable to register [" + provider + "], permission denied");
		}
	}

	/**
	 * Wrapper to ensure task executes on the runtime thread
	 *
	 * @param locationProviders 		list of location providers to enable by registering
	 * 									the providers with the OS
	 */
	public void enableLocationProviders(final HashMap<String, LocationProviderProxy> locationProviders)
	{
	    if (!TiApplication.isUIThread()) {
            runInUiThread(new CommandNoReturn() {
                @Override
                public void execute() {
                    enableLocationProviders(locationProviders);
                }
            }, false); 
            return;
        }
	    doEnableLocationProviders(locationProviders);
	}

	
	private void doDisableLocationProviders()
	{
		for (LocationProviderProxy locationProvider : legacyLocationProviders.values()) {
			tiLocation.locationManager.removeUpdates(locationProvider);
		}

		for (LocationProviderProxy locationProvider : simpleLocationProviders.values()) {
			tiLocation.locationManager.removeUpdates(locationProvider);
		}

		if (androidModule != null) {
			for (LocationProviderProxy locationProvider : androidModule.manualLocationProviders.values()) {
				tiLocation.locationManager.removeUpdates(locationProvider);
			}
		}
		
		if (shouldFireStateChange && !destroyed && hasListeners("state", false)) {
            KrollDict data = new KrollDict();
            data.put("monitor", TiC.PROPERTY_LOCATION);
            data.put("state", false);
            fireEvent("state", data, false, false);
       }
//		Log.d(TAG, "doDisableLocationProviders done");
	}
	
	/**
	 * Enables the specified location behavior mode by registering the associated
	 * providers with the OS.  Even if the specified mode is currently active, the
	 * current mode will be disabled by de-registering all the associated providers
	 * for that mode with the OS and then registering
	 * them again.  This can be useful in cases where the properties for all the
	 * providers have been updated and they need to be re-registered in order for the
	 * change to take effect.  Modification of the list of providers for any mode
	 * should occur on the runtime thread in order to make sure threading issues are
	 * avoiding
	 *
	 * @param locationProviders
	 */
	private void doEnableLocationProviders(HashMap<String, LocationProviderProxy> locationProviders)
	{
		if (numLocationListeners > 0 || singleLocationCallback != null) {
		    shouldFireStateChange = false;
			doDisableLocationProviders();
            shouldFireStateChange  = true;
			
			if (!destroyed && hasListeners("state", false)) {
                KrollDict data = new KrollDict();
                data.put("monitor", TiC.PROPERTY_LOCATION);
                data.put("state", true);
                fireEvent("state", data, false, false);
           }

			Iterator<String> iterator = locationProviders.keySet().iterator();
			while(iterator.hasNext()) {
				LocationProviderProxy locationProvider = locationProviders.get(iterator.next());
				registerLocationProvider(locationProvider);
			}
			
		}
	}

	/**
	 * Disables the current mode by de-registering all the associated providers
	 * for that mode with the OS.  Providers are just de-registered with the OS,
	 * not removed from the list of providers we associate with the behavior mode.
	 */
	private void disableLocationProviders()
	{
//	    if (!locationProvidersEnabled) {
//            return;
//        }
//        locationProvidersEnabled = false;
	    if (!TiApplication.isUIThread()) {
            runInUiThread(new CommandNoReturn() {
                @Override
                public void execute() {
                    disableLocationProviders();
                }
            }, false); 
            return;
        }
	    doDisableLocationProviders();
	}
	
	   
    private boolean enableLocationProviders() {
//        if (locationProvidersEnabled) {
//            return;
//        }
     // fire off an initial location fix if one is available
        if (!hasLocationPermissions()) {
            Log.e(TAG, "Location permissions missing");
            return false;
        }
//        locationProvidersEnabled = true;
        if (!TiApplication.isUIThread()) {
//            final Activity activity = getActivity();
//            if (activity != null) {
//                activity.runOnUiThread(new Runnable() {
//                    @Override
//                    public void run() {
//                        enableLocationProviders();
//                    }
//                });
//            }
            runInUiThread(new CommandNoReturn() {
                @Override
                public void execute() {
                    enableLocationProviders();
                }
            }, false); 
            return true;
        }
        HashMap<String, LocationProviderProxy> locationProviders = legacyLocationProviders;

        if (getManualMode()) {
            locationProviders = androidModule.manualLocationProviders;

        } else if (!legacyModeActive) {
            locationProviders = simpleLocationProviders;
        }
        enableLocationProviders(locationProviders);
        
        
        //restart rules to be sure.
        lastRulesCheckedLocation = null;
        return true;
    }
    
    
    public boolean getAndUpdateServicesEnabled() {
//        if (!listeningForChanges) {
            boolean state = tiLocation.getLocationServicesEnabled();
            if (state != currentlyEnabled) {
                currentlyEnabled = state;
            }
//        }
        return currentlyEnabled;
    }

	/**
	 * Checks if the device has a valid location service present.  The passive location service
	 * is not counted.
	 *
	 * @return			<code>true</code> if a valid location service is available on the device,
	 * 					<code>false</code> if not
	 */
	@Kroll.getProperty @Kroll.method
	public boolean getLocationServicesEnabled()
	{
		return getAndUpdateServicesEnabled();
	}

	/**
	 * Retrieves the last known location and returns it to the specified Javascript function
	 *
	 * @param callback			Javascript function that will be invoked with the last known location
	 */
	@Kroll.method
	public void getCurrentPosition(KrollFunction callback)
	{
		if (!hasLocationPermissions()) {
			Log.e(TAG, "Location permissions missing");
			return;
		}
		if (callback != null) {
//			Location latestKnownLocation = tiLocation.getLastKnownLocation();
//
//			if (latestKnownLocation != null) {
//		        Log.d(TAG, "getCurrentPosition calling with last location");
//				callback.call(this.getKrollObject(), new Object[] {
//					buildLocationEvent(latestKnownLocation, tiLocation.locationManager.getProvider(latestKnownLocation.getProvider()))
//				});
//				lastRulesCheckedLocation = latestKnownLocation;
//			} else if (currentlyEnabled) {
//			    singleLocationCallback = callback;
//			    enableLocationProviders();
//			}
			if (getAndUpdateServicesEnabled()) {
                singleLocationCallback = callback;
                enableLocationProviders();
            }
		}
	}

	/**
	 * Converts the specified address to coordinates and returns the value to the specified
	 * Javascript function
	 *
	 * @param address			address to be converted
	 * @param callback			Javascript function that will be invoked with the coordinates
	 * 							for the specified address if available
	 */
	@Kroll.method
	public void forwardGeocoder(String address, KrollFunction callback)
	{
		tiLocation.forwardGeocode(address, createGeocodeResponseHandler(callback));
	}

	/**
	 * Converts the specified latitude and longitude to a human readable address and returns
	 * the value to the specified Javascript function
	 *
	 * @param latitude			latitude to be used in looking up the associated address
	 * @param longitude			longitude to be used in looking up the associated address
	 * @param callback			Javascript function that will be invoked with the address
	 * 							for the specified latitude and longitude if available
	 */
	@Kroll.method
	public void reverseGeocoder(double latitude, double longitude, KrollFunction callback)
	{
		tiLocation.reverseGeocode(latitude, longitude, createGeocodeResponseHandler(callback));
	}

	/**
	 * Convenience method for creating a response handler that is used when doing a
	 * geocode lookup.
	 *
	 * @param callback			Javascript function that the response handler will invoke
	 * 							once the geocode response is ready
	 * @return					the geocode response handler
	 */
	private GeocodeResponseHandler createGeocodeResponseHandler(final KrollFunction callback)
	{
		final GeolocationModule geolocationModule = this;

		return new GeocodeResponseHandler() {
			@Override
			public void handleGeocodeResponse(KrollDict geocodeResponse)
			{
				geocodeResponse.put(TiC.EVENT_PROPERTY_SOURCE, geolocationModule);
				callback.call(getKrollObject(), new Object[] { geocodeResponse });
			}
		};
	}

	/**
	 * Called to determine if the specified location is "better" than the current location.
	 * This is determined by comparing the new location to the current location according
	 * to the location rules (if any are set) for the current behavior mode.  If no rules
	 * are set for the current behavior mode, the new location is always accepted.
	 *
	 * @param newLocation		location to evaluate
	 * @return					<code>true</code> if the location has been deemed better than
	 * 							the current location based on the existing rules set for the
	 * 							current behavior mode, <code>false</code> if not
	 */
	private boolean shouldUseUpdate(Location newLocation)
	{
		boolean passed = false;
		if (newLocation == null) return passed;
//		if (lastLocation != null) {
//		    if (lastLocation.getAltitude() == newLocation.getAltitude() && 
//		            lastLocation.getLatitude() == newLocation.getLatitude() &&
//		                    lastLocation.getLongitude() == newLocation.getLongitude() &&
//		                            lastLocation.getBearing() == newLocation.getBearing()) {
//		        return passed;
//		    }
//		}
		if (getManualMode()) {
			if (androidModule.manualLocationRules.size() > 0) {
				for(LocationRuleProxy rule : androidModule.manualLocationRules) {
					if (rule.check(lastRulesCheckedLocation, newLocation)) {
						passed = true;

						break;
					}
				}

			} else {
				passed = true; // no rules set, always accept
			}

		} else if (!legacyModeActive) {
			for(LocationRuleProxy rule : simpleLocationRules) {
				if (rule.check(lastRulesCheckedLocation, newLocation)) {
					passed = true;

					break;
				}
			}

		// TODO remove this block when legacy mode is removed
		} else {
			// the legacy mode will fall here, don't filter the results
			passed = true;
		}

		return passed;
	}

	/**
	 * Convenience method used to package a location from a location provider into a
	 * consumable form for the Titanium developer before it is fire back to Javascript.
	 *
	 * @param location				location that needs to be packaged into consumable form
	 * @param locationProvider		location provider that provided the location update
	 * @return						map of property names and values that contain information
	 * 								pulled from the specified location
	 */
	private KrollDict buildLocationEvent(Location location, LocationProvider locationProvider)
 {
        KrollDict coordinates = new KrollDict();
        coordinates.put(TiC.PROPERTY_LATITUDE, location.getLatitude());
        coordinates.put(TiC.PROPERTY_LONGITUDE, location.getLongitude());
        if (location.hasAltitude()) {
            coordinates.put(TiC.PROPERTY_ALTITUDE, location.getAltitude());

        }
        if (location.hasAccuracy()) {
            coordinates.put(TiC.PROPERTY_ACCURACY, location.getAccuracy());
        }
//        coordinates.put(TiC.PROPERTY_ALTITUDE_ACCURACY, null); // Not provided
        if (location.hasBearing()) {
            coordinates.put(TiC.PROPERTY_HEADING, location.getBearing());
        }
        if (location.hasSpeed()) {
            coordinates.put(TiC.PROPERTY_SPEED, location.getSpeed());
        }
        coordinates.put(TiC.PROPERTY_TIMESTAMP, location.getTime());

        KrollDict event = new KrollDict();
        event.putCodeAndMessage(TiC.ERROR_CODE_NO_ERROR, null);
        event.put(TiC.PROPERTY_COORDS, coordinates);

        if (locationProvider != null) {
            KrollDict provider = new KrollDict();
            provider.put(TiC.PROPERTY_NAME, locationProvider.getName());
            provider.put(TiC.PROPERTY_ACCURACY, locationProvider.getAccuracy());
            provider.put(TiC.PROPERTY_POWER,
                    locationProvider.getPowerRequirement());

            event.put(TiC.PROPERTY_PROVIDER, provider);
        }

        return event;
    }
	
	
	/**
	 * Convenience method used to package a error into a consumable form
	 * for the Titanium developer before it is fired back to Javascript.
	 *
	 * @param code					Error code identifying the error
	 * @param msg					Error message describing the event
	 * @return						map of property names and values that contain information
	 * 								regarding the error
	 */
	private KrollDict buildLocationErrorEvent(int code, String msg)
	{
		KrollDict d = new KrollDict(3);
		d.putCodeAndMessage(code, msg);
		return d;
	}

	@Override
	public String getApiName()
	{
		return "Ti.Geolocation";
	}

	@Override
	public void onDestroy(Activity activity) {
	    destroyed = true;
	    if (mStatusReceiver != null) {
            getActivity().unregisterReceiver(mStatusReceiver);
            mStatusReceiver = null;
        }
		//clean up event listeners
		if (compassListenersRegistered) {
			tiCompass.unregisterListener();
			compassListenersRegistered = false;
		}
		disableLocationProviders();
		super.onDestroy(activity);

	}
	
    @Kroll.method
    @Kroll.setProperty
    public void setHeadingFilter(float filter)
    {
        tiCompass.setHeadingFilter(filter);
    }
    
    @Kroll.method
    @Kroll.getProperty
    public float getHeadingFilter()
    {
        return tiCompass.getHeadingFilter();
    }
}
