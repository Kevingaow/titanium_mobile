/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2009-2016 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */
package ti.modules.titanium.app.properties;

import org.appcelerator.kroll.KrollModule;
import org.appcelerator.kroll.KrollDict;
import org.appcelerator.kroll.annotations.Kroll;
import org.appcelerator.titanium.TiApplication;
import org.appcelerator.titanium.TiC;
import org.appcelerator.titanium.TiProperties;

import org.appcelerator.titanium.util.TiConvert;

import ti.modules.titanium.app.AppModule;

import android.content.SharedPreferences;

@Kroll.module(parentModule=AppModule.class)
public class PropertiesModule extends KrollModule {

	private TiProperties appProperties;
	private SharedPreferences.OnSharedPreferenceChangeListener listener;

	public PropertiesModule()
	{
		super();

		appProperties = TiApplication.getInstance().getAppProperties();
		listener = new SharedPreferences.OnSharedPreferenceChangeListener() {
			public void onSharedPreferenceChanged(SharedPreferences prefs,String key) {
				KrollDict result = new KrollDict();
				result.put("property", key); 
				fireEvent(TiC.EVENT_CHANGE, result);
			}
		};
		appProperties.getPreference().registerOnSharedPreferenceChangeListener(listener);
	}

	@Kroll.method
	public boolean getBool(String key, @Kroll.argument(optional=true) Object obj)
	{
		Boolean defaultValue = false;
		if (obj != null) {
			defaultValue = TiConvert.toBoolean(obj);
		}
		return appProperties.getBool(key, defaultValue);
	}

	@Kroll.method
	public double getDouble(String key, @Kroll.argument(optional=true) Object obj)
	{
		double defaultValue = 0D;
		if (obj != null) {
			defaultValue = TiConvert.toDouble(obj);
		}
		return appProperties.getDouble(key, defaultValue);
	}

	@Kroll.method
	public int getInt(String key, @Kroll.argument(optional=true) Object obj)
	{
		int defaultValue = 0;
		if (obj != null) {
			defaultValue = TiConvert.toInt(obj);
		}
		return appProperties.getInt(key, defaultValue);
	}

	@Kroll.method
	public String getString(String key, @Kroll.argument(optional=true) String defaultValue)
	{
		return appProperties.getString(key, defaultValue);
	}

	@Kroll.method
	public boolean hasProperty(String key)
	{
		return appProperties.hasProperty(key);
	}

	@Kroll.method
	public String[] listProperties()
	{
		return appProperties.listProperties();
	}

	@Kroll.method
	public void removeProperty(String key)
	{
		if (hasProperty(key)) {
			appProperties.removeProperty(key);
		}
	}
	
	@Kroll.method
	public void removeAllProperties()
	{
		appProperties.removeAllProperties();
	}

	@Kroll.method
	public void setBool(String key, boolean value)
	{
		Object boolValue = appProperties.getPreference(key);
		if (boolValue == null || !boolValue.equals(value)) {
			appProperties.setBool(key, value);
		}
	}

	@Kroll.method
	public void setDouble(String key, double value)
	{
		Object doubleValue = appProperties.getPreference(key);
		//Since there is no double type in SharedPreferences, we store doubles as strings, i.e "10.0"
		//so we need to convert before comparing.
		if (doubleValue == null || !doubleValue.equals(String.valueOf(value))) {
			appProperties.setDouble(key, value);
		}
	}

	@Kroll.method
	public void setInt(String key, int value)
	{
		Object intValue = appProperties.getPreference(key);
		if (intValue == null || !intValue.equals(value)) {
			appProperties.setInt(key, value);
		}

	}

	@Kroll.method
	public void setString(String key, String value)
	{
		Object stringValue = appProperties.getPreference(key);
		if (stringValue == null || !stringValue.equals(value)) {
			appProperties.setString(key, value);
		}
	}

	@Override
	public String getApiName()
	{
		return "Ti.App.Properties";
	}
}
