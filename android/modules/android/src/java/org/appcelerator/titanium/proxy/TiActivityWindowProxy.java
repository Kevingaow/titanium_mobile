/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2009-2012 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */
package org.appcelerator.titanium.proxy;

import java.util.HashMap;

import org.appcelerator.kroll.KrollDict;
import org.appcelerator.kroll.annotations.Kroll;
import org.appcelerator.kroll.common.Log;
import org.appcelerator.titanium.TiC;
import org.appcelerator.titanium.view.TiUIActivityWindow;
import org.appcelerator.titanium.view.TiUIView;

import ti.modules.titanium.android.AndroidModule;
import android.app.Activity;

@Kroll.proxy(creatableInModule=AndroidModule.class)
public class TiActivityWindowProxy extends TiWindowProxy
{
	private static final String TAG = "TiActivityWindowProxy";

	public TiActivityWindowProxy()
	{
		super();

		// force to true since the window is actually opened from TiUIActivityWindow
		// TODO make this lifecycle less weird
//		opened = true;
	}

	public void setView(TiUIView view)
	{
		this.view = view;
	}

	@Override
	protected void handleClose(HashMap options)
	{
		Log.w(TAG, "handleClose", Log.DEBUG_MODE);
		fireEvent(TiC.EVENT_CLOSE, null);

		if (view != null) {
			((TiUIActivityWindow)view).close();
		}

		releaseViews(true);
//		opened = false;
	}

	@Override
	protected void handleOpen(HashMap options)
	{
	}

	@Override
	protected Activity getWindowActivity()
	{
		if (view == null) return null;
		return ((TiUIActivityWindow)view).getActivity();
	}
}
