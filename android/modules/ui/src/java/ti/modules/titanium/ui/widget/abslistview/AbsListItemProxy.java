/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2013 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */

package ti.modules.titanium.ui.widget.abslistview;

import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.appcelerator.kroll.KrollProxy;
import org.appcelerator.kroll.KrollDict;
import org.appcelerator.kroll.annotations.Kroll;
import org.appcelerator.titanium.TiC;
import org.appcelerator.titanium.TiViewEventOverrideDelegate;
import org.appcelerator.titanium.proxy.TiViewProxy;
import org.appcelerator.titanium.util.TiConvert;
import org.appcelerator.titanium.view.TiUIView;

//import ti.modules.titanium.ui.widget.abslistview.AbsListSectionProxy.AbsListItemData;
import android.app.Activity;

@Kroll.proxy
public class AbsListItemProxy extends TiViewProxy implements KrollProxy.SetPropertyChangeListener, TiViewEventOverrideDelegate
{
    protected WeakReference<TiViewProxy> listProxy;
	
	private HashMap<String, ProxyAbsListItem> bindingsMap;
	private Set<KrollProxy> nonBindingProxies;
    private ProxyAbsListItem listItem;
    private Object itemData;
	
	public int sectionIndex = -1;
    public int itemIndex = -1;
    protected WeakReference<AbsListSectionProxy> sectionProxy;
	
	public void setCurrentItem(final int sectionIndex, final int itemIndex, final AbsListSectionProxy sectionProxy, final Object itemData)
    {
        this.sectionIndex = sectionIndex;
        this.itemIndex = itemIndex;
        this.sectionProxy = new WeakReference<AbsListSectionProxy>(sectionProxy);
        this.itemData = itemData;
    }
	
	public void updateItemIndex(final int index) {
        this.itemIndex = index;
	}
	
	public HashMap getItemDataForBindId(final String bindId) {
	    if (this.itemData instanceof HashMap) {
	        Object data = ((HashMap) this.itemData).get(bindId);
	        if (data instanceof HashMap) {
	            return (HashMap) data;
	        }
	    }
	    
	    return null;
	}
	
	public AbsListItemProxy()
	{
	    shouldAskForGC = false;
		bindingsMap = new HashMap<String, ProxyAbsListItem>();
		nonBindingProxies = new HashSet();
	}

	public TiUIView createView(final Activity activity)
	{
		return null;
	}

	public void setListProxy(final TiViewProxy list)
	{
		listProxy = new WeakReference<TiViewProxy>(list);
	}

	public TiViewProxy getListProxy()
	{
		if (listProxy != null) {
			return listProxy.get();
		}
		return null;
	}
	
	@Override
	public KrollProxy getParentForBubbling()
	{
		return getListProxy();
	}

	public boolean fireEvent(final String event, final Object data, boolean bubbles, boolean checkParent)
	{
		if (event.equals(TiC.EVENT_CLICK)) {
		    fireItemClick(event, data);
		}
		return super.fireEvent(event, data, bubbles, checkParent);
	}

	private void fireItemClick(String event, Object data)
	{
        if (super.hasListeners(TiC.EVENT_ITEM_CLICK)) {
			super.fireEvent(TiC.EVENT_ITEM_CLICK, data, true, false);
		}
	}

	@Override
	public boolean hasListeners(final String event, final boolean bubbles)
	{
		// In order to fire the "itemclick" event when the children views are clicked,
		// the children views' "click" events must be fired and bubbled up. (TIMOB-14901)
		if (event.equals(TiC.EVENT_CLICK)) {
			return super.hasListeners(TiC.EVENT_CLICK, bubbles) || 
			        super.hasListeners(TiC.EVENT_ITEM_CLICK, bubbles);
		}
		return super.hasListeners(event, bubbles);
	}

	public void release()
	{
		super.release();
		bindingsMap.clear();
		nonBindingProxies.clear();
		if (listProxy != null) {
			listProxy = null;
		}
		if (sectionProxy != null) {
		    sectionProxy = null;
        }
	}

	public KrollProxy getProxyFromBinding(final String binding) {
		ProxyAbsListItem viewItem = bindingsMap.get(binding);
		if (viewItem != null) {
			return viewItem.getProxy();
		}
		return null;
	}
	
	@Override
    public void addBinding(final String bindId, final KrollProxy bindingProxy)
	{
	    if (bindingProxy == null) {
            return;
        }
		super.addBinding(bindId, bindingProxy);
		if (bindId != null) {
			ProxyAbsListItem viewItem = new ProxyAbsListItem(bindingProxy, bindingProxy.getClonedProperties());
			bindingsMap.put(bindId, viewItem);
		}
		else {
			nonBindingProxies.add(bindingProxy);
		}
		
	}
	
	public HashMap<String, ProxyAbsListItem> getBindings() {
		return bindingsMap;
	}
	
	public Set<KrollProxy> getNonBindedProxies() {
		return nonBindingProxies;
	}
	
	public ProxyAbsListItem getListItem() {
		if (listItem == null) {
			listItem = new ProxyAbsListItem(this, getProperties());
		}
		return listItem;
	}

    @Override
    public void onSetProperty(final KrollProxy proxy, final String name, final Object value) {
        for (Map.Entry<String, ProxyAbsListItem> entry : bindingsMap.entrySet()) {
            String key = entry.getKey();
            ProxyAbsListItem item = entry.getValue();
            if (item.getProxy() == proxy) {
                item.setCurrentProperty(name, value);
                if (sectionProxy != null) {
                    sectionProxy.get().updateItemAt(itemIndex, key, name, value);
                }
                return;
            }
        }
    }
    
    @Override
    public Object onGetProperty(final KrollProxy proxy, final String name) {
        for (Map.Entry<String, ProxyAbsListItem> entry : bindingsMap.entrySet()) {
            ProxyAbsListItem item = entry.getValue();
            if (item.getProxy() == proxy ) {
                Object value = item.getCurrentProperty(name);
                return value;
            }
        }
        return null;
    }
    
    @Override
    public void onApplyProperties(final KrollProxy proxy, final HashMap arg, boolean force, boolean wait) {
        for (Map.Entry<String, ProxyAbsListItem> entry : bindingsMap.entrySet()) {
            String key = entry.getKey();
            ProxyAbsListItem item = entry.getValue();
            if (item.getProxy() == proxy) {
                HashMap diffProperties = item.generateDiffProperties((HashMap) arg);
                if (sectionProxy != null) {
                    sectionProxy.get().updateItemAt(itemIndex, key, diffProperties);
                }
                proxy.internalApplyModelProperties(diffProperties);
                return;
            }
        }
    }

    @Override
    public Object overrideEvent(Object data, String type, KrollProxy proxy) {
        if (data != null && !(data instanceof KrollDict)) {
            return data;
        }
        KrollDict dict = (KrollDict) data;
        if (dict == null) {
            dict = new KrollDict();
        }
        else if (dict.containsKey(TiC.PROPERTY_SECTION)) {
            return data; //already done
        }
        dict.put(TiC.PROPERTY_SECTION, sectionProxy.get());
        dict.put(TiC.PROPERTY_SECTION_INDEX, sectionIndex);
        dict.put(TiC.PROPERTY_ITEM_INDEX, itemIndex);
        dict.put(TiC.PROPERTY_ITEM, itemData);
        String bindId =proxy.getBindId();
        if (bindId != null) {
            dict.put(TiC.PROPERTY_BIND_ID, bindId);
        }
        String itemId = TiConvert.toString(
                proxy.getProperty(TiC.PROPERTY_ITEM_ID), null);
        if (itemId != null) {
            dict.put(TiC.PROPERTY_ITEM_ID, itemId);
        }
        return dict;
    }
	
	
}
