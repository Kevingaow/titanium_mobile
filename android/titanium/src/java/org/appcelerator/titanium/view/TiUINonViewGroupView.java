package org.appcelerator.titanium.view;

import org.appcelerator.kroll.KrollDict;
import org.appcelerator.titanium.TiC;
import org.appcelerator.titanium.proxy.TiViewProxy;
import org.appcelerator.titanium.util.TiConvert;

import android.view.View;
import android.view.ViewGroup;

public class TiUINonViewGroupView extends TiUIView {

	public TiUINonViewGroupView(TiViewProxy proxy) {
		super(proxy);
	}
	
	public TiUINonViewGroupView(TiViewProxy proxy, TiCompositeLayout.LayoutParams params) {
        super(proxy, params);
	}

	protected TiCompositeLayout childrenHolder = null;
	@Override
	public void add(TiUIView child, int index)
	{
		if (childrenHolder == null) {
			createChildrenHolder();
		}
		super.add(child, index);
	}
	
    protected void updateLayoutForChildren(KrollDict d) {
        View viewForLayout = getParentViewForChild();

        if (viewForLayout instanceof TiCompositeLayout) {
            TiCompositeLayout tiLayout = (TiCompositeLayout) viewForLayout;
            if (d.containsKey(TiC.PROPERTY_LAYOUT)) {
                String layout = TiConvert.toString(d, TiC.PROPERTY_LAYOUT);
                tiLayout.setLayoutArrangement(layout);
                d.remove(TiC.PROPERTY_LAYOUT);
            }

            if (d.containsKey(TiC.PROPERTY_HORIZONTAL_WRAP)) {
                tiLayout.setEnableHorizontalWrap(TiConvert.toBoolean(d,
                        TiC.PROPERTY_HORIZONTAL_WRAP, true));
                d.remove(TiC.PROPERTY_HORIZONTAL_WRAP);
            }
        }
    }

	protected void createChildrenHolder(){
		childrenHolder = new TiCompositeLayout(proxy.getActivity(), this) {
		    @Override
		    public void dispatchSetPressed(boolean pressed) {
		            int count = getChildCount();
		            for (int i = 0; i < count; i++) {
		                final View child = getChildAt(i);
		                child.setPressed(pressed);
		            }
		    };
		};
		if (proxy.hasProperty(TiC.PROPERTY_CLIP_CHILDREN)) {
			boolean value = TiConvert.toBoolean(proxy.getProperty(TiC.PROPERTY_CLIP_CHILDREN));
			childrenHolder.setClipChildren(value);	
			if (TiC.LOLLIPOP_OR_GREATER) {
			    childrenHolder.setClipToOutline(value);
	        }
		}
		TiCompositeLayout.LayoutParams params = new TiCompositeLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
		params.notTiLayout = true;
		getOrCreateBorderView().addView(childrenHolder, params);
        
		updateLayoutForChildren(proxy.getProperties());	
	}
	
	@Override
	public boolean propagateSetPressed(final View view, boolean pressed) {
        setState(pressed?"pressed":null);
        if (dispatchPressed) {
            if (childrenHolder != null) {
                childrenHolder.setPressed(pressed);
            }
        }
        return dispatchPressed;
    }

	@Override
	public ViewGroup getParentViewForChild()
	{
		return childrenHolder != null ? childrenHolder: super.getParentViewForChild();
	}
}
