/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */
package ti.modules.titanium.ui.widget;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.regex.Pattern;

import org.appcelerator.kroll.KrollDict;
import org.appcelerator.titanium.TiApplication;
import org.appcelerator.titanium.TiC;
import org.appcelerator.titanium.proxy.TiViewProxy;
import org.appcelerator.titanium.transition.Transition;
import org.appcelerator.titanium.transition.TransitionHelper;
import org.appcelerator.titanium.util.TiConvert;
import org.appcelerator.titanium.util.TiHtml;
import org.appcelerator.titanium.util.TiHtml.CustomBackgroundSpan;
import org.appcelerator.titanium.util.TiHtml.URLSpanNoUnderline;
import org.appcelerator.titanium.util.TiTypefaceSpan;
import org.appcelerator.titanium.util.TiUIHelper;
import org.appcelerator.titanium.view.FreeLayout;
import org.appcelerator.titanium.view.TiUINonViewGroupView;
import org.appcelerator.titanium.view.TiUIView;

import android.animation.Animator;
import android.animation.AnimatorSet;
import android.animation.ArgbEvaluator;
import android.animation.ObjectAnimator;
import android.content.Context;
import android.content.res.ColorStateList;
import ti.modules.titanium.ui.AttributedStringProxy;
import ti.modules.titanium.ui.UIModule;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint.Join;
import android.graphics.Paint.Style;
import android.graphics.PointF;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Build;
import android.support.v7.widget.AppCompatTextView;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
//import in.uncod.android.bypass.Bypass;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.Layout.Alignment;
import android.text.Selection;
import android.text.Spannable;
import android.text.Spannable.Factory;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils.TruncateAt;
import android.text.style.AbsoluteSizeSpan;
import android.text.style.BackgroundColorSpan;
import android.text.style.BulletSpan;
import android.text.style.ClickableSpan;
import android.text.style.ForegroundColorSpan;
import android.text.style.ImageSpan;
import android.text.style.MaskFilterSpan;
import android.text.style.QuoteSpan;
import android.text.style.RasterizerSpan;
import android.text.style.RelativeSizeSpan;
import android.text.style.ScaleXSpan;
import android.text.style.StrikethroughSpan;
import android.text.style.StyleSpan;
import android.text.style.SubscriptSpan;
import android.text.style.SuperscriptSpan;
import android.text.style.TextAppearanceSpan;
import android.text.style.TypefaceSpan;
import android.text.style.URLSpan;
import android.text.style.UnderlineSpan;
import android.util.TypedValue;

@SuppressWarnings({"unchecked", "rawtypes"})
public class TiUILabel extends TiUINonViewGroupView
{
	private static final String TAG = "TiUILabel";
    private static final boolean HONEYCOMB_OR_GREATER = (Build.VERSION.SDK_INT >= 11);
	private static final float DEFAULT_SHADOW_RADIUS = 0.5f;
	
	protected static final int TIFLAG_NEEDS_COLORS               = 0x00000001;
    protected static final int TIFLAG_NEEDS_TEXT                 = 0x00000002;
    protected static final int TIFLAG_NEEDS_TEXT_HTML            = 0x00000004;
    protected static final int TIFLAG_NEEDS_SHADOW               = 0x00000008;
    protected static final int TIFLAG_NEEDS_LINKIFY              = 0x00000010;
    protected static final int TIFLAG_NEEDS_TEXT_MARKDOWN        = 0x00000020;

    private static final Pattern sHTMLPattern = Pattern.compile("<\\/?[A-Za-z][^>]*>|&[a-z]+;");
    
	private int selectedColor, color, disabledColor;
	private boolean wordWrap = true;
	private float shadowRadius = DEFAULT_SHADOW_RADIUS;
    private PointF shadowOffset = new PointF(0f, -1f);
	private boolean shadowEnabled = false;
	private int shadowColor = Color.TRANSPARENT;
    private boolean disableLinkStyle = false;
    private int autoLink = 16; // NONE
    private CharSequence text = null;
    
    private float strokeWidth = 0;
    private Integer strokeColor = Color.TRANSPARENT;
    private Join strokeJoin = Join.MITER;
    private float strokeMiter = 10;
	private String minimumFontSize = null;
	private String autoshrinkSetFontSize = null;


	private RectF textPadding = null;
	private String ELLIPSIZE_CHAR = "...";

	private TiLabelView tv;
	private HashMap transitionDict = null;
	
	private static class TiLinkSpan extends ClickableSpan {
	    public final String link;
	    public TiLinkSpan(String link) {
	        this.link = link;
	    }

        @Override
        public void onClick(View widget) {            
        }
	    
	}
	
	public class TiLabelView extends FreeLayout {

		public EllipsizingTextView textView;
		private EllipsizingTextView oldTextView = null;

		private Transition  queuedTransition = null;
		private AnimatorSet  currentTransitionSet = null;
		private CharSequence  queuedText = null;
		
		@Override
		public void dispatchSetPressed(boolean pressed) {
			int count = getChildCount();
			for (int i = 0; i < count; i++) {
	            final View child = getChildAt(i);
	            child.setPressed(pressed);
	        }
		}
		public TiLabelView(Context context) {
			super(context);
			this.setAddStatesFromChildren(true);
			textView = new EllipsizingTextView(context);
			TiUIView.setBackgroundDrawable(textView, null);
			textView.setGravity(Gravity.CENTER_VERTICAL | Gravity.LEFT);
 			textView.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
			textView.setKeyListener(null);
			textView.setSingleLine(false);
			if (HONEYCOMB_OR_GREATER) {
	            textView.setTextIsSelectable(false);
			}
            textView.setSelectAllOnFocus(false);
            textView.setLinksClickable(false);
			TiUIHelper.styleText(textView, (HashMap)null);
			addView(textView, getTextLayoutParams());
		}
		
		private ViewGroup.LayoutParams getTextLayoutParams() {
			ViewGroup.LayoutParams params  = new ViewGroup.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
			return params;
		}
		
		@Override
	    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
			
			int maxHeight = 0;
	        int maxWidth = 0;
	        
	        //those lines try to fix the TextView using a min when set to MeasureSpec.AT_MOST
			if (layoutParams.optionWidth == null && layoutParams.autoFillsWidth) {
				int w = MeasureSpec.getSize(widthMeasureSpec);
				widthMeasureSpec = MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY);
            }
			if (layoutParams.optionHeight == null && layoutParams.autoFillsHeight) {
				int h = MeasureSpec.getSize(heightMeasureSpec);
				heightMeasureSpec = MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY);
            }
			//
			
	        if (textView.getVisibility() != GONE) {
                measureChildWithMargins(textView, widthMeasureSpec, 0, heightMeasureSpec, 0);
                final FreeLayout.LayoutParams lp = (FreeLayout.LayoutParams) textView.getLayoutParams();
                maxWidth = Math.max(maxWidth,
                		textView.getMeasuredWidth() + lp.leftMargin + lp.rightMargin);
                maxHeight = Math.max(maxHeight,
                		textView.getMeasuredHeight() + lp.topMargin + lp.bottomMargin);
            }
	        // Account for padding too
	        maxWidth += getPaddingLeft() + getPaddingRight();
	        maxHeight += getPaddingTop() + getPaddingBottom();
	        
	        setMeasuredDimension(resolveSize(maxWidth, widthMeasureSpec),
	                resolveSize(maxHeight, heightMeasureSpec));
	    }

		public void setText(EllipsizingTextView view, CharSequence sequence)
		{
			if (sequence instanceof Spannable)
			{
				view.setText(sequence, TextView.BufferType.SPANNABLE);
			}
			else {
				view.setText(sequence);
			}
		}
		
		public void setText(CharSequence sequence)
		{
			if(textView != null && textView.fullText != null && textView.fullText.equals(sequence)) return;
			Transition transition = (transitionDict != null && proxy.viewInitialised())?TransitionHelper.transitionFromObject(transitionDict, null, null):null;
			if (transition != null) 
			{
				setTextWithTransition(sequence, transition);
			}
			else {
				setText(textView, sequence);
			}
		}
		
		public void setTextWithTransition(CharSequence text, Transition transition) {
			if (currentTransitionSet != null) {
				queuedTransition = transition;
				queuedText = text;
				return;
			}
			EllipsizingTextView newTextView = textView.clone(text);
			transitionToTextView(newTextView, transition);
		}
		
		private void onTransitionEnd() {
			removeView(oldTextView);
			oldTextView = null;
			currentTransitionSet = null;
			if (queuedText != null) {
				setTextWithTransition(queuedText, queuedTransition);
				queuedTransition = null;
				queuedText = null;
			}
		}
		
		public void cancelCurrentTransition()
		{
			queuedTransition = null;
			queuedText = null;
			currentTransitionSet = null;
		}
		

		public void transitionToTextView(EllipsizingTextView newTextView, Transition transition) {
			oldTextView = textView;
			textView = newTextView;
//			oldTextView.setClickable(false);
			oldTextView.setOnTouchListener(null);//we need to remove it or we will receive a cancel event on remove view
			registerForTouch();
			registerForKeyPress();
			TransitionHelper.CompletionBlock onDone = new TransitionHelper.CompletionBlock() {
	            
	            @Override
	            public void transitionDidFinish(boolean success) {
	                onTransitionEnd();
	            }
	        };
	        Animator anim = null;
	        //            Animator anim = createAnimationLayoutUpdater(this, oldTextView);
	        currentTransitionSet = TransitionHelper.transitionViews(this, textView, oldTextView, onDone, transition, getTextLayoutParams(), anim);
		}
	}

	public class EllipsizingTextView extends AppCompatTextView {

		private TruncateAt ellipsize = null;
		private TruncateAt multiLineEllipsize = null;
		private boolean isEllipsized;
		private boolean needsEllipsing;
		private boolean needsResizing;
		private boolean singleline = false;
		private boolean readyToEllipsize = false;
		private CharSequence fullText;
		private int maxLines = 0;
		private float lineSpacingMultiplier = 1.0f;
		private float lineAdditionalVerticalPadding = 0.0f;
		private float minTextSize;
		private float maxTextSize;
		
		float lastEllipsizeWidth = -1;
		float lastEllipsizeHeight = -1;
        private boolean frozen = false;
        private int[] lockedCompoundPadding;
		
		@Override
	    public void onDraw(Canvas canvas){
	        if(strokeColor != Color.TRANSPARENT && strokeWidth > 0){
	            freeze();
	            int restoreColor = this.getCurrentTextColor();
	            TextPaint paint = this.getPaint();
	            paint.setStyle(Style.STROKE);
	            paint.setStrokeJoin(strokeJoin);
	            paint.setStrokeMiter(strokeMiter);
	            this.setTextColor(strokeColor);
	            paint.setStrokeWidth(strokeWidth*2); // because the stroke is centered and not outside
	            super.onDraw(canvas);
	            paint.setStyle(Style.FILL);
                this.setTextColor(restoreColor);
	            unfreeze();
	        }
            super.onDraw(canvas);
		}
		
		int lastMeasuredWidth = -1;
		int lastMeasuredHeight = -1;
		@Override
		protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec)
		{
			int w = MeasureSpec.getSize(widthMeasureSpec);
//			int wm = MeasureSpec.getMode(widthMeasureSpec);
			int h = MeasureSpec.getSize(heightMeasureSpec);
			int hm = MeasureSpec.getMode(heightMeasureSpec);
			if (hm == 0) h = 100000;
			
			
			if ((hm == MeasureSpec.AT_MOST || hm == MeasureSpec.UNSPECIFIED) && (fullText == null || fullText.length() == 0)) {
                heightMeasureSpec = MeasureSpec.makeMeasureSpec(0,
                        MeasureSpec.EXACTLY);
            }
			else if (w > 0) {
				if (needsResizing) {
					refitText(this.getText().toString(), w);
				}
				final boolean autoSize = layoutParams.optionWidth == null && !layoutParams.autoFillsWidth;
				
				if (w != lastMeasuredWidth || h != lastMeasuredHeight) {
                    updateEllipsize(w - getPaddingLeft() - getPaddingRight(), 
                            h - getPaddingTop() - getPaddingBottom());
                } else {
                    if (needsEllipsize() && readyToEllipsize == true && needsEllipsing == true)  {
                        ellipseText(w - getPaddingLeft() - getPaddingRight(), 
                                h - getPaddingTop() - getPaddingBottom());
                    }
                }
				lastMeasuredWidth = w;
				lastMeasuredHeight = h;
				
		//			 Only allow label to exceed the size of parent when it's size behavior with wordwrap disabled
				if (!wordWrap && autoSize) {
				    
				    widthMeasureSpec = MeasureSpec.makeMeasureSpec(w,
						MeasureSpec.UNSPECIFIED);
					heightMeasureSpec = MeasureSpec.makeMeasureSpec(h,
						MeasureSpec.UNSPECIFIED);
				}
			}
			
			super.onMeasure(widthMeasureSpec, heightMeasureSpec);
		}

        @Override
        public void dispatchSetPressed(boolean pressed) {
            if (propagateSetPressed(this, pressed)) {
                super.dispatchSetPressed(pressed);
            }
        }
		
        @Override
        public boolean onTouchEvent(MotionEvent event) {
            TextView textView = (TextView) this;
            Object text = textView.getText();
            // For html texts, we will manually detect url clicks.
            if (text instanceof CharSequence) {
                CharSequence spanned = (CharSequence) text;
                Spannable buffer = Factory.getInstance().newSpannable(
                        spanned.subSequence(0, spanned.length()));

                int action = event.getAction();

                if (action == MotionEvent.ACTION_UP
                        || action == MotionEvent.ACTION_DOWN) {
                    int x = (int) event.getX();
                    int y = (int) event.getY();

                    x -= textView.getTotalPaddingLeft();
                    y -= textView.getTotalPaddingTop();

                    x += textView.getScrollX();
                    y += textView.getScrollY();

                    Layout layout = textView.getLayout();
                    int line = layout.getLineForVertical(y);
                    int off = layout.getOffsetForHorizontal(line, x);

                    ClickableSpan[] link = buffer.getSpans(off, off,
                            ClickableSpan.class);

                    if (link.length != 0) {
                        ClickableSpan cSpan = link[0];
                        if (action == MotionEvent.ACTION_UP) {
							if(cSpan instanceof TiLinkSpan && proxy.hasListeners(TiC.PROPERTY_LINK)) {
								KrollDict evnt = new KrollDict();
								evnt.put("url", ((TiLinkSpan)cSpan).link);
								proxy.fireEvent(TiC.PROPERTY_LINK, evnt, false);
							//} else {
//								cSpan.onClick(textView);
							}
                        } else if (action == MotionEvent.ACTION_DOWN) {
                            Selection.setSelection(buffer,
                                    buffer.getSpanStart(cSpan),
                                    buffer.getSpanEnd(cSpan));
                        }
                    }
                }

            }

            return super.onTouchEvent(event);
        }
	
		@Override
		public boolean dispatchTouchEvent(MotionEvent event) {
			if (touchPassThrough(getParentViewForChild(), event)) return false;
			return super.dispatchTouchEvent(event);
		}
		
		// Keep these things locked while onDraw in processing
	    public void freeze(){
	        lockedCompoundPadding = new int[]{
	                getCompoundPaddingLeft(),
	                getCompoundPaddingRight(),
	                getCompoundPaddingTop(),
	                getCompoundPaddingBottom()
	        };
	        frozen = true;
	    }
	    
	    public void unfreeze(){
	        frozen = false;
	    }
	    
	    
	    @Override
	    public void requestLayout(){
	        if(!frozen) super.requestLayout();
	    }
	    
	    @Override
	    public void postInvalidate(){
	        if(!frozen) super.postInvalidate();
	    }
	    
	   @Override
	    public void postInvalidate(int left, int top, int right, int bottom){
	        if(!frozen) super.postInvalidate(left, top, right, bottom);
	    }
	    
	    @Override
	    public void invalidate(){
	        if(!frozen) super.invalidate();
	    }
	    
	    @Override
	    public void invalidate(Rect rect){
	        if(!frozen) super.invalidate(rect);
	    }
	    
	    @Override
	    public void invalidate(int l, int t, int r, int b){
	        if(!frozen) super.invalidate(l,t,r,b);
	    }
	    
	    @Override
	    public int getCompoundPaddingLeft(){
	        return !frozen ? super.getCompoundPaddingLeft() : lockedCompoundPadding[0];
	    }
	    
	    @Override
	    public int getCompoundPaddingRight(){
	        return !frozen ? super.getCompoundPaddingRight() : lockedCompoundPadding[1];
	    }
	    
	    @Override
	    public int getCompoundPaddingTop(){
	        return !frozen ? super.getCompoundPaddingTop() : lockedCompoundPadding[2];
	    }
	    
	    @Override
	    public int getCompoundPaddingBottom(){
	        return !frozen ? super.getCompoundPaddingBottom() : lockedCompoundPadding[3];
	    }
		
		public EllipsizingTextView(Context context) {
			super(context);
			maxTextSize = this.getTextSize();
			if (maxTextSize < 35) {
				maxTextSize = 30;
			}
			minTextSize = 20;
			needsResizing = false;
			super.setSingleLine(false);
		}
		
		public EllipsizingTextView clone(CharSequence text) {
			EllipsizingTextView newView = new EllipsizingTextView(getContext());
//			newView.setInputType(getInputType());
			newView.setGravity(getGravity());
			if (TiC.JELLY_BEAN_OR_GREATER) {
	            newView.setKeyListener(null);
			}
            TiUIView.setBackgroundDrawable(newView, getBackground());
			TiUIHelper.styleText(newView, getProxy().getProperties().getKrollDict(TiC.PROPERTY_FONT));
			newView.setEllipsize(ellipsize);
			newView.singleline = this.singleline;
//			newView.setSingleLine(this.singleline);
			newView.maxLines = this.maxLines;
			newView.maxTextSize = this.maxTextSize;
			newView.minTextSize = this.minTextSize;
			newView.lineAdditionalVerticalPadding = this.lineAdditionalVerticalPadding;
			newView.lineSpacingMultiplier = this.lineSpacingMultiplier;
			newView.multiLineEllipsize = this.multiLineEllipsize;
			newView.setTextColor(getTextColors());
			newView.setPadding(getPaddingLeft(), getPaddingTop(), getPaddingRight(), getPaddingBottom());
			if (shadowEnabled) {
	            newView.setShadowLayer(shadowRadius, shadowOffset.x, shadowOffset.y, shadowColor);
			}
			if (text instanceof Spannable)
			{
				newView.setText(text, TextView.BufferType.SPANNABLE);
			}
			else {
				newView.setText(text);
			}
			newView.SetReadyToEllipsize(true);
			return newView;
		}
		

		public float getMinTextSize() {
			return minTextSize;
		}
		
		public void setMinTextSize(float minTextSize) {
			this.minTextSize = minTextSize;
		}
		
		public float getMaxTextSize() {
			return maxTextSize;
		}
		
		public void setMaxTextSize(float minTextSize) {
			this.maxTextSize = minTextSize;
		}


		public boolean isEllipsized() {
			return isEllipsized;
		}

		public void SetReadyToEllipsize(Boolean value){
			readyToEllipsize = value;
//			if (readyToEllipsize == true)
//				updateEllipsize();
		}

		@Override
		public void setMaxLines(int maxLines) {
			
			super.setMaxLines((maxLines == 0)?Integer.MAX_VALUE:maxLines);
			if (maxLines == Integer.MAX_VALUE) maxLines = 0;
			this.maxLines = maxLines;
			updateEllipsize();
		}
		
		
		public void updateEllipsize(int width, int height){
			if (needsEllipsize())  {
				needsEllipsing = true;
				if (readyToEllipsize == true) {
				    ellipseText(width, height);
				}
			}
		}
	
		public void updateEllipsize(){
		    if (needsEllipsize())  {
                needsEllipsing = true;
                if (readyToEllipsize == true) {
                    ellipseText(getMeasuredWidth(), getMeasuredHeight());
                }
            }
		}

		public int getMaxLines() {
			return maxLines;
		}
		

		@Override
		public void setLineSpacing(float add, float mult) {
			this.lineAdditionalVerticalPadding = add;
			this.lineSpacingMultiplier = mult;
			super.setLineSpacing(add, mult);
			updateEllipsize();
		}
		
		
		@Override
		public void setTypeface(Typeface tf, int style){
			super.setTypeface(tf, style);
			updateEllipsize();
		}
		
		@Override
		public void setTextSize(int unit, float size){
			super.setTextSize(unit, size);
			updateEllipsize();
		}
		
		protected void makeLinkClickable(SpannableStringBuilder strBuilder, final URLSpan span)
		{
            int start = strBuilder.getSpanStart(span);
            int end = strBuilder.getSpanEnd(span);
            int flags = strBuilder.getSpanFlags(span);
            TiLinkSpan clickable = new TiLinkSpan(span.getURL());
            strBuilder.setSpan(clickable, start, end, flags);
            strBuilder.removeSpan(span);
        }

		private boolean linkifying = false;
		@Override
		public void setText(CharSequence text, BufferType type) {
		    //first set the super text so that linkifyIfEnabled
		    //can read the value
            super.setText(text, type);
            if (!linkifying && autoLink != 16) {
                linkifying = true;
                TiUIHelper.linkifyIfEnabled(this, autoLink);
                text = super.getText();
                linkifying = false;
            }
		    if (text instanceof Spannable) {
		        SpannableStringBuilder strBuilder = (SpannableStringBuilder) ((text instanceof SpannableStringBuilder)?text:new SpannableStringBuilder(text));
                URLSpan[] span = strBuilder.getSpans(0, text.length(), URLSpan.class);
                for (int i = span.length - 1; i >= 0; i--) {
                    makeLinkClickable(strBuilder, span[i]);
                }
                text = strBuilder;
                super.setText(text, type);
            }
			fullText = text;
			
			
			updateEllipsize();
		}
		
//		@Override
//        public CharSequence getText() {
//            return fullText != null;
//        }
		
		@Override
		public void setSingleLine (boolean singleLine) {
			if (this.singleline == singleLine) return;
			this.singleline = singleLine;
			if (this.maxLines == 1 && singleLine == false){
				//we were at maxLines==1 and singleLine==true
				//it s actually the same thing now so let s not change anything
			}
			else{
				super.setSingleLine(singleLine);
			}
			updateEllipsize();
		}

		@Override
		public void setEllipsize(TruncateAt where) {
			super.setEllipsize(where);
			ellipsize = where;
			updateEllipsize();
		}
		
		@Override
		protected void onTextChanged(final CharSequence text, final int start,
			final int before, final int after) {
			if (needsResizing) {
				refitText(this.getText().toString(),  this.getWidth());
			}
		}

		public void setMultiLineEllipsize(TruncateAt where) {
			multiLineEllipsize = where;
			updateEllipsize();
		}
		
		public TruncateAt getMultiLineEllipsize() {
			return multiLineEllipsize;
		}
		
		private void refitText(String text, int textWidth) {
			if (textWidth > 0) {
				int availableWidth = textWidth - this.getPaddingLeft()
				- this.getPaddingRight();
				float trySize = maxTextSize;

				this.setTextSize(TypedValue.COMPLEX_UNIT_PX, trySize);
				while ((trySize > minTextSize)
					&& (this.getPaint().measureText(text) > availableWidth)) {
					trySize -= 1;
				if (trySize <= minTextSize) {
					trySize = minTextSize;
					break;
				}
				this.setTextSize(TypedValue.COMPLEX_UNIT_PX, trySize);
			}
			this.setTextSize(TypedValue.COMPLEX_UNIT_PX, trySize);
		}
	}
	
		private CharSequence strimText(CharSequence text)
		{
			int strimEnd = text.toString().trim().length();
			if (strimEnd != text.length()){
				return text.subSequence(0, strimEnd);
			}
			return text;
		}
		
		private CharSequence getEllipsedTextForOneLine(CharSequence text, TruncateAt where, int width){
			CharSequence newText = strimText(text);				
			int length = ELLIPSIZE_CHAR.length();
			if (where == TruncateAt.START || where == TruncateAt.END){
				if (where == TruncateAt.START) {
					newText = TextUtils.concat(ELLIPSIZE_CHAR, newText);
				}
				else if(where == TruncateAt.END) {
					newText = TextUtils.concat(newText, ELLIPSIZE_CHAR);
				}
				newText = TextUtils.ellipsize(newText, getPaint(), width, where);
				if (newText.length() <= length) return newText;
				String textStr = newText.toString();
				if (where == TruncateAt.START && !textStr.startsWith(ELLIPSIZE_CHAR)) {
					newText = TextUtils.concat(ELLIPSIZE_CHAR, newText.subSequence(length, textStr.length()));
				}
				else if(where == TruncateAt.END && !textStr.endsWith(ELLIPSIZE_CHAR)) {
					newText = TextUtils.concat(newText.subSequence(0, textStr.length() - length), ELLIPSIZE_CHAR);
				}
			}
			else {
				CharSequence newTextLeft = TextUtils.ellipsize(newText, getPaint(), width/2, TruncateAt.END);
				CharSequence newTextRight = TextUtils.ellipsize(newText, getPaint(), width/2, TruncateAt.START);
				String textLeftStr = newTextLeft.toString();
				String textRightStr = newTextRight.toString();
				if (textLeftStr.length() == 0 || (
						textLeftStr.length() + textRightStr.length() == newText.toString().length())) return newText;
				if (!textLeftStr.endsWith(ELLIPSIZE_CHAR)) {
					newTextLeft = TextUtils.concat(ELLIPSIZE_CHAR, newTextLeft.subSequence(length, textLeftStr.length()));
				}
				if (textRightStr.startsWith(ELLIPSIZE_CHAR)) {
					newTextRight = (CharSequence) newTextRight.subSequence(length, newTextRight.length());
				}
				newText = TextUtils.concat(newTextLeft, newTextRight);
			}
			return newText;

		}
		
		// @SuppressLint("NewApi")
		private Object duplicateSpan(Object span){
			if (span instanceof ForegroundColorSpan){
				return new ForegroundColorSpan(((ForegroundColorSpan)span).getForegroundColor());
			}
			if (span instanceof BackgroundColorSpan){
				return new BackgroundColorSpan(((BackgroundColorSpan)span).getBackgroundColor());
			}
			else if (span instanceof AbsoluteSizeSpan){
				return new AbsoluteSizeSpan(((AbsoluteSizeSpan)span).getSize(), ((AbsoluteSizeSpan)span).getDip());
			}
			else if (span instanceof RelativeSizeSpan){
				return new RelativeSizeSpan(((RelativeSizeSpan)span).getSizeChange());
			}
			else if (span instanceof TextAppearanceSpan){
				return new TextAppearanceSpan(((TextAppearanceSpan)span).getFamily(), ((TextAppearanceSpan)span).getTextStyle(), ((TextAppearanceSpan)span).getTextSize(), ((TextAppearanceSpan)span).getTextColor(), ((TextAppearanceSpan)span).getLinkTextColor());
			}
			else if (span instanceof URLSpanNoUnderline){
                return new URLSpanNoUnderline(((URLSpanNoUnderline)span).getURL());
            }
			else if (span instanceof URLSpan){
                return new URLSpan(((URLSpan)span).getURL());
            }
			else if (span instanceof TiLinkSpan){
                return new TiLinkSpan(((TiLinkSpan)span).link);
            }
			else if (span instanceof UnderlineSpan){
				return new UnderlineSpan();
			}
			else if (span instanceof SuperscriptSpan){
				return new SuperscriptSpan();
			}
			else if (span instanceof SubscriptSpan){
				return new SubscriptSpan();
			}
			else if (span instanceof StrikethroughSpan){
				return new StrikethroughSpan();
			}
			else if (span instanceof BulletSpan){
				return new BulletSpan();
			}
//			else if (span instanceof ClickableSpan){
//				return new ClickableSpan();
//			}
			else if (span instanceof ScaleXSpan){
				return new ScaleXSpan(((ScaleXSpan)span).getScaleX());
			}
			else if (span instanceof StyleSpan){
				return new StyleSpan(((StyleSpan)span).getStyle());
			}
			else if (span instanceof TypefaceSpan){
				return new TypefaceSpan(((TypefaceSpan)span).getFamily());
			}
			else if (span instanceof TiTypefaceSpan){
				return new TiTypefaceSpan(((TypefaceSpan)span).getFamily());
			}
			else if (span instanceof ImageSpan){
				return new ImageSpan(((ImageSpan)span).getDrawable());
			}
			else if (span instanceof RasterizerSpan){
				return new RasterizerSpan(((RasterizerSpan)span).getRasterizer());
			}
			else if (span instanceof QuoteSpan){
				return new QuoteSpan(((QuoteSpan)span).getColor());
			}
			else if (span instanceof MaskFilterSpan){
				return new MaskFilterSpan(((MaskFilterSpan)span).getMaskFilter());
			}
			else if (span instanceof CustomBackgroundSpan){
				return new CustomBackgroundSpan(((CustomBackgroundSpan)span));
			}
			
			return null;
		}
		
		public boolean needsEllipsize(){
			return fullText != null && fullText.length() > 0 && (ellipsize != null || multiLineEllipsize != null);
		}

		private void ellipseText(int width, int height) {
			if (!needsEllipsize() || needsEllipsing == false
					|| (width <= 0) || (height <= 0)) return;
//			if (width == lastEllipsizeWidth && height == lastEllipsizeHeight)
//			{
//				needsEllipsing = false;
//				return;
//			}
			boolean ellipsized = false;
			CharSequence workingText = fullText;

			if (fullText instanceof Spanned){
				SpannableStringBuilder htmlWorkingText = new SpannableStringBuilder(fullText);
				if (this.singleline == false && multiLineEllipsize != null) {
					SpannableStringBuilder newText = new SpannableStringBuilder();
					String str = htmlWorkingText.toString();
					String[] separated = str.split("\n");
					int start = 0;
					int newStart = 0;
					for (int i = 0; i < separated.length; i++) {
						String linestr = separated[i];
						int end = start +  linestr.length();
						if (linestr.length() > 0){
							SpannableStringBuilder lineSpanned = (SpannableStringBuilder) htmlWorkingText.subSequence(start, end);
							Object[] spans = lineSpanned.getSpans(0, lineSpanned.length(), Object.class);
							
							//this is a trick to get the Spans for the last line to be used in getEllipsedTextForOneLine
							//we append,setSpans, getlastline with spans, ellipse, replace last line with last line ellipsized
							newText.append(lineSpanned.toString());
							for (int j = 0; j < spans.length; j++) {
								int start2 = htmlWorkingText.getSpanStart(spans[j]);
								int end2 = htmlWorkingText.getSpanEnd(spans[j]);
								int mystart = newStart + Math.max(0, start2 - start);
								int spanlengthonline = Math.min(end2, start + linestr.length()) - Math.max(start2, start);
								int myend = Math.min(mystart + spanlengthonline, newStart + lineSpanned.length());
								int flags = htmlWorkingText.getSpanFlags(spans[j]);
								if (myend > mystart){
									Object newSpan = duplicateSpan(spans[j]);
									newText.setSpan(newSpan, mystart, myend, flags);
								}
							}

							CharSequence lastLine = newText.subSequence(newStart, newStart + lineSpanned.length());
							if (createWorkingLayout(lastLine, width).getLineCount() > 1) 
								lastLine = getEllipsedTextForOneLine(lastLine, multiLineEllipsize, width);

							newText.replace(newStart, newStart + lineSpanned.length(), lastLine);
						}
						if (i < (separated.length - 1)) newText.append('\n');
						start = end + 1;
						newStart = newText.length();
					}
					workingText = newText;
				}
				else {
					Layout layout = createWorkingLayout(workingText, width);
					int linesCount = getLinesCount(layout, height);
					if (layout.getLineCount() > linesCount && ellipsize != null) {
						if (linesCount >= 2) {
							int start2 = layout.getLineStart(linesCount - 1);
							int end1 = layout.getLineEnd(linesCount - 2);
							int end2 = layout.getLineEnd(linesCount - 1);
							SpannableStringBuilder newText = new SpannableStringBuilder();
							newText.append(fullText.subSequence(0, end1));
							// We have more lines of text than we are allowed to display.
							newText.append(getEllipsedTextForOneLine(fullText.subSequence(start2, end2), ellipsize, width));
							workingText = newText;
						} else {
							workingText = getEllipsedTextForOneLine(fullText.subSequence(0, layout.getLineEnd(linesCount - 1)), ellipsize, width);
						}
					}
				}
			}
			else {
				if (this.singleline == false && multiLineEllipsize != null) {
					String str = workingText.toString();
					String newText = new String();
					String[] separated = str.split("\n");
					for (int i = 0; i < separated.length; i++) {
						String linestr = separated[i];
						if (linestr.length() > 0){
							if (createWorkingLayout(linestr, width).getLineCount() > 1)
								newText += getEllipsedTextForOneLine(linestr, multiLineEllipsize, width);
							else
								newText += linestr;
						}
						if (i < (separated.length - 1)) 
							newText += '\n';
					}
					workingText = newText;
				}
				else {
					Layout layout = createWorkingLayout(workingText, width);
					int linesCount = getLinesCount(layout, height);
					if (layout.getLineCount() > linesCount && ellipsize != null) {
						if (linesCount >= 2) {
							int start2 = layout.getLineStart(linesCount - 1);
							int end1 = layout.getLineEnd(linesCount - 2);
							int end2 = layout.getLineEnd(linesCount - 1);
							SpannableStringBuilder newText = new SpannableStringBuilder();
							newText.append(fullText.subSequence(0, end1));
							// We have more lines of text than we are allowed to display.
							newText.append(getEllipsedTextForOneLine(fullText.subSequence(start2, end2), ellipsize, width));
							workingText = newText;
						} else {
							workingText = getEllipsedTextForOneLine(fullText.subSequence(0, layout.getLineEnd(linesCount - 1)), ellipsize, width);
						}
						
					}
				}
			}
			
			
			if (!workingText.equals(getText())) {
				try {
					super.setText(workingText, TextView.BufferType.SPANNABLE);
				} finally {
					ellipsized = true;
					
				}
			}
			needsEllipsing = false;
			lastEllipsizeWidth = width;
			lastEllipsizeHeight = height;
			if (ellipsized != isEllipsized) {
				isEllipsized = ellipsized;
			}
		}

		/**
		* Get how many lines of text we are allowed to display.
		*/
//		private int getLinesCount(int width, int height) {
//			int fullyVisibleLinesCount = getFullyVisibleLinesCount(width, height);
//			if (fullyVisibleLinesCount == -1) {
//				return fullyVisibleLinesCount = 1;
//			}
//			return (maxLines == 0)?fullyVisibleLinesCount:Math.min(maxLines, fullyVisibleLinesCount);
//		}

		private int getLinesCount(Layout layout, int height) {
			int fullyVisibleLinesCount = getFullyVisibleLinesCount(layout, height);
			if (fullyVisibleLinesCount == -1) {
				return fullyVisibleLinesCount = 1;
			}
			return (maxLines == 0)?fullyVisibleLinesCount:Math.min(maxLines, fullyVisibleLinesCount);
		}

		/**
		* Get how many lines of text we can display so their full height is visible.
		*/
//		private int getFullyVisibleLinesCount(int width, int height) {
//			Layout layout = createWorkingLayout(fullText, width);
//			return getFullyVisibleLinesCount(layout, height);
//		}

		private int getFullyVisibleLinesCount(Layout layout, int height) {
			int totalLines = layout.getLineCount();
			int index = totalLines - 1;
			int lineHeight = layout.getLineBottom(index);
			while(lineHeight > height) {
				index -= 1;
				lineHeight = layout.getLineBottom(index);
			}
			return index + 1;
		}

		private Layout createWorkingLayout(CharSequence workingText, int width) {
			return new StaticLayout(workingText, getPaint(),
				width,
				Alignment.ALIGN_NORMAL, lineSpacingMultiplier,
				lineAdditionalVerticalPadding, false /* includepad */);
		}
		
		public int getOffsetForPosition(float x, float y) {
	        if (getLayout() == null) return -1;
	        final int line = getLineNumberAtCoordinate(y);
	        final int offset = getOffsetAtCoordinate(line, x);
	        return offset;
	    }

	    float convertToHorizontalCoordinate(float x) {
	        x -= getTotalPaddingLeft();
	        // Clamp the position to inside of the view.
	        x = Math.max(0.0f, x);
	        x = Math.min(getWidth() - getTotalPaddingRight() - 1, x);
	        x += getScrollX();
	        return x;
	    }

	    int getLineNumberAtCoordinate(float y) {
	        y -= getTotalPaddingTop();
	        // Clamp the position to inside of the view.
	        y = Math.max(0.0f, y);
	        y = Math.min(getHeight() - getTotalPaddingBottom() - 1, y);
	        y += getScrollY();
	        return getLayout().getLineForVertical((int) y);
	    }
	    
	    private int getOffsetAtCoordinate(int line, float x) {
	        x = convertToHorizontalCoordinate(x);
	        return getLayout().getOffsetForHorizontal(line, x);
	    }
	}

	protected static final ArrayList<String> KEY_SEQUENCE;
    static{
      ArrayList<String> tmp = new ArrayList<String>();
      tmp.add(TiC.PROPERTY_COLOR);
      KEY_SEQUENCE = tmp;
    }
    @Override
    protected ArrayList<String> keySequence() {
        return KEY_SEQUENCE;
    }
	public TiUILabel(final TiViewProxy proxy)
	{
		super(proxy);
		tv = new TiLabelView(getProxy().getActivity()) {
			@Override
			protected void onLayout(boolean changed, int left, int top, int right, int bottom)
			{
				super.onLayout(changed, left, top, right, bottom);
                if (changed) {
                    adjustTextFontSize(this);
                    TiUIHelper.firePostLayoutEvent(TiUILabel.this);
                }
			}
		};
		textPadding = new RectF();
		tv.setFocusable(false);
		tv.setFocusableInTouchMode(true);
		color = disabledColor = selectedColor = getTextView().getCurrentTextColor();
        updatePadding();
		setNativeView(tv);

	}
	
	/**
     * Method used to decrease the fontsize of the text to fit the width
     * fontsize should be >= than the property minimumFontSize
     * @param v
     */
    private void adjustTextFontSize(View v){    
        if (minimumFontSize != null){
            TextView tv = getTextView();

            if (tv != null) {
                if (autoshrinkSetFontSize != null) {
                    if (tv.getTextSize() == TiConvert.toFloat(autoshrinkSetFontSize)) {
                        String[] fontProperties = TiUIHelper.getFontProperties(proxy.getProperties());

                        if (fontProperties.length > TiUIHelper.FONT_SIZE_POSITION && fontProperties[TiUIHelper.FONT_SIZE_POSITION] != null) {
                            tv.setTextSize(TiUIHelper.getSizeUnits(fontProperties[TiUIHelper.FONT_SIZE_POSITION]), TiUIHelper.getSize(fontProperties[TiUIHelper.FONT_SIZE_POSITION]));
                        } else {
                            tv.setTextSize(TiUIHelper.getSizeUnits(null), TiUIHelper.getSize(null));
                        }
                    }
                }
                
                TextPaint textPaint = tv.getPaint();
                if (textPaint != null) {
                    float stringWidth = textPaint.measureText(tv.getText().toString());
                    int textViewWidth = tv.getWidth();
                    if (textViewWidth < stringWidth && stringWidth > 0) {
                        float fontSize = (textViewWidth / stringWidth) * tv.getTextSize();
                        autoshrinkSetFontSize = fontSize > TiConvert.toFloat(minimumFontSize, 0) ? String.valueOf(fontSize) : minimumFontSize;
                        tv.setTextSize(TiUIHelper.getSizeUnits(autoshrinkSetFontSize), TiUIHelper.getSize(autoshrinkSetFontSize));
                    }
                }
            }
        }
    }


//	private CharSequence fromHtml(CharSequence str)
//	{
//	    return TiHtml.fromHtml(str, disableLinkStyle);
////		SpannableStringBuilder htmlText = new SpannableStringBuilder(TiHtml.fromHtml(str, disableLinkStyle));
////		return htmlText;
//	}
	
	private void updateTextColors() {
		int[][] states = new int[][] {
			TiUIHelper.BACKGROUND_DISABLED_STATE, // disabled
			TiUIHelper.BACKGROUND_SELECTED_STATE, // pressed
			TiUIHelper.BACKGROUND_FOCUSED_STATE,  // pressed
			TiUIHelper.BACKGROUND_CHECKED_STATE,  // pressed
			new int [] {android.R.attr.state_pressed},  // pressed
			new int [] {android.R.attr.state_focused},  // pressed
			new int [] {}
		};

		ColorStateList colorStateList = new ColorStateList(
			states,
			new int[] {disabledColor, selectedColor, selectedColor, selectedColor, selectedColor, selectedColor, color}
		);

		tv.textView.setTextColor(colorStateList);
	}
	
//	protected CharSequence prepareMarkdown(String str)
//    {
//	    Bypass bypass = new Bypass(getContext());
//	    return bypass.markdownToSpannable(str);
//    }
	protected CharSequence prepareHtml(CharSequence str)
	{
	    return TiHtml.fromHtml(str, disableLinkStyle);
	}

	@Override
    protected void aboutToProcessProperties(HashMap d) {
        super.aboutToProcessProperties(d);
        getTextView().SetReadyToEllipsize(false);
    }
	
	private void updatePadding() {
      if (shadowEnabled) {
          getTextView().setPadding(
                  (int)textPadding.left + (int)Math.max(0, -shadowOffset.x), 
                  (int)textPadding.top + (int)Math.max(0, -shadowOffset.y), 
                  (int)textPadding.right + (int)Math.max(0, shadowOffset.x),
                  (int)textPadding.bottom + (int)Math.max(0, shadowOffset.y));
      } else {
          getTextView().setPadding(
                  (int)textPadding.left, 
                  (int)textPadding.top, 
                  (int)textPadding.right,
                  (int)textPadding.bottom);
      }
	    
	}
    
    @Override
    protected void didProcessProperties() {
        boolean needsLayout = false;
        final EllipsizingTextView textview = getTextView();
        if ((mProcessUpdateFlags & TIFLAG_NEEDS_COLORS) != 0) {
            updateTextColors();
            mProcessUpdateFlags &= ~TIFLAG_NEEDS_COLORS;
        }
        if ((mProcessUpdateFlags & TIFLAG_NEEDS_SHADOW) != 0) {
            shadowEnabled = shadowRadius != 0 && shadowColor != Color.TRANSPARENT;
            textview.setShadowLayer(shadowRadius, shadowOffset.x, shadowOffset.y, shadowColor);
            mProcessUpdateFlags &= ~TIFLAG_NEEDS_SHADOW;
            //reset padding after shadow is necessary
            updatePadding();
        }

        if ((mProcessUpdateFlags & TIFLAG_NEEDS_TEXT) != 0) {
//            if ((mProcessUpdateFlags & TIFLAG_NEEDS_TEXT_MARKDOWN) != 0) {
//                if (text instanceof String) {
//                    tv.setText(prepareMarkdown((String) text));
//                } else {
//                    tv.setText(text);
//                }
//                mProcessUpdateFlags &= ~TIFLAG_NEEDS_TEXT_MARKDOWN;
//           } else 
               if ((mProcessUpdateFlags & TIFLAG_NEEDS_TEXT_HTML) != 0) {
                tv.setText((text!= null)?prepareHtml(text):text);
                mProcessUpdateFlags &= ~TIFLAG_NEEDS_TEXT_HTML;
            } else {
                tv.setText(text);
            }
            mProcessUpdateFlags &= ~TIFLAG_NEEDS_TEXT;
            mProcessUpdateFlags &= ~TIFLAG_NEEDS_LINKIFY;
//            if (autoLink != 16) {
//                mProcessUpdateFlags |= TIFLAG_NEEDS_LINKIFY;
//            }
            needsLayout = true;
        }
        if ((mProcessUpdateFlags & TIFLAG_NEEDS_LINKIFY) != 0) {
            textview.setText(textview.fullText);
//            if (text != null) {
//                TiUIHelper.linkifyIfEnabled(textview, autoLink);
//            }
            mProcessUpdateFlags &= ~TIFLAG_NEEDS_LINKIFY;
        }
        //call after so that a layout computes ellipsize
        textview.SetReadyToEllipsize(true);
        if (needsLayout) {
            textview.requestLayout();
        }
        super.didProcessProperties();
    }
 
    private EllipsizingTextView getTextView() {
        return tv.textView;
    }
    
    @Override
    public void propertySet(String key, Object newValue, Object oldValue,
            boolean changedProperty) {
        switch (key) {
        case TiC.PROPERTY_COLOR:
            color = selectedColor = disabledColor = color = TiConvert.toColor(newValue, this.color);
            mProcessUpdateFlags |= TIFLAG_NEEDS_COLORS;
            break;
        case "strokeColor":
            strokeColor = TiConvert.toColor(newValue, Color.TRANSPARENT);
            setNeedsLayout();
            break;
        case "strokeWidth":
            strokeWidth = TiUIHelper.getInPixels(newValue);
            setNeedsLayout();
            break;
        case TiC.PROPERTY_SELECTED_COLOR:
            selectedColor = TiConvert.toColor(newValue, this.selectedColor);
            mProcessUpdateFlags |= TIFLAG_NEEDS_COLORS;
            break;
        case TiC.PROPERTY_DISABLED_COLOR:
            disabledColor = TiConvert.toColor(newValue, this.disabledColor);
            mProcessUpdateFlags |= TIFLAG_NEEDS_COLORS;
            break;
        case TiC.PROPERTY_HIGHLIGHTED_COLOR:
            getTextView().setHighlightColor(TiConvert.toColor(newValue));
            break;
        case TiC.PROPERTY_INCLUDE_FONT_PADDING:
            getTextView().setIncludeFontPadding(TiConvert.toBoolean(newValue, true));
            break;
        case TiC.PROPERTY_FONT:
            TiUIHelper.styleText(getTextView(), TiConvert.toHashMap(newValue));
            setNeedsLayout();
            break;
        case TiC.PROPERTY_TEXT_ALIGN:
            TiUIHelper.setAlignment(getTextView(), TiConvert.toString(newValue), null);
            setNeedsLayout();
            break;
        case TiC.PROPERTY_VERTICAL_ALIGN:
            TiUIHelper.setAlignment(getTextView(), null, TiConvert.toString(newValue));
            setNeedsLayout();
            break;
        case "textIsSelectable":
            if (TiC.HONEYCOMB_OR_GREATER) {
                getTextView().setTextIsSelectable(TiConvert.toBoolean(newValue, false));
            }
            break;
        case TiC.PROPERTY_TEXT_PADDING:
            textPadding = TiConvert.toPaddingRect(newValue, textPadding);
            updatePadding();
            setNeedsLayout();
            break;
        case TiC.PROPERTY_ELLIPSIZE:
            if (newValue instanceof Boolean) {
                getTextView().setEllipsize(((Boolean)newValue)?TruncateAt.END:null);
            }
            else {
                String str = TiConvert.toString(newValue);
                if (str != null && !str.equals("none")) //none represents TEXT_ELLIPSIS_NONE
                    getTextView().setEllipsize(TruncateAt.valueOf(str));
                else
                    getTextView().setEllipsize(null);
            }
            break;
        case TiC.PROPERTY_MULTILINE_ELLIPSIZE:
            if (newValue instanceof Boolean) {
                getTextView().setMultiLineEllipsize(((Boolean)newValue)?TruncateAt.END:null);
            }
            else {
                String str = TiConvert.toString(newValue);
                if (str != null && !str.equals("none")) //none represents TEXT_ELLIPSIS_NONE
                    getTextView().setMultiLineEllipsize(TruncateAt.valueOf(str));
                else
                    getTextView().setMultiLineEllipsize(null);
            }
            break;
        case TiC.PROPERTY_WORD_WRAP:
            getTextView().setSingleLine(!TiConvert.toBoolean(newValue, false));
            setNeedsLayout();
            break;
        case TiC.PROPERTY_MAX_LINES:
            getTextView().setMaxLines(TiConvert.toInt(newValue, 0));
            break;
        case TiC.PROPERTY_LINES:
            getTextView().setLines(TiConvert.toInt(newValue, 0));
            break;
        case TiC.PROPERTY_SHADOW_OFFSET:
            shadowOffset = TiConvert.toPointF(newValue);

            mProcessUpdateFlags |= TIFLAG_NEEDS_SHADOW;
            break;
        case TiC.PROPERTY_SHADOW_RADIUS:
            shadowRadius = TiConvert.toFloat(newValue, DEFAULT_SHADOW_RADIUS);
            mProcessUpdateFlags |= TIFLAG_NEEDS_SHADOW;
            break;
        case TiC.PROPERTY_SHADOW_COLOR:
            shadowColor = TiConvert.toColor(newValue);
            mProcessUpdateFlags |= TIFLAG_NEEDS_SHADOW;
            break;
        case TiC.PROPERTY_AUTO_LINK:
            autoLink = TiConvert.toInt(newValue, UIModule.AUTOLINK_NONE);
            mProcessUpdateFlags |= TIFLAG_NEEDS_LINKIFY;
            break;
        case TiC.PROPERTY_MARKDOWN:
            text = TiConvert.toString(newValue);
            mProcessUpdateFlags |= TIFLAG_NEEDS_TEXT;
            mProcessUpdateFlags |= TIFLAG_NEEDS_TEXT_MARKDOWN;
            break;
        case TiC.PROPERTY_HTML:
            text = TiConvert.toString(newValue);
            mProcessUpdateFlags |= TIFLAG_NEEDS_TEXT;
            if (text != null && sHTMLPattern.matcher(text).find()) {
                mProcessUpdateFlags |= TIFLAG_NEEDS_TEXT_HTML;
            }
            break;
        case TiC.PROPERTY_TEXT:
        case TiC.PROPERTY_TITLE:
            if ((mProcessUpdateFlags & TIFLAG_NEEDS_TEXT) == 0) {
                text = TiConvert.toString(newValue);
                mProcessUpdateFlags |= TIFLAG_NEEDS_TEXT;
            }
            break;
        case TiC.PROPERTY_ATTRIBUTED_STRING:
			if (newValue instanceof AttributedStringProxy) {
				Spannable spannableText = AttributedStringProxy.toSpannable(((AttributedStringProxy)newValue), TiApplication.getAppCurrentActivity());
				text = spannableText;
                mProcessUpdateFlags |= TIFLAG_NEEDS_TEXT;
			}
            break;
        case TiC.PROPERTY_TRANSITION:
            if (newValue instanceof HashMap) {
                transitionDict = (HashMap) newValue;
            }
            else {
                transitionDict = null;
            }
            break;
        case TiC.PROPERTY_DISABLE_LINK_STYLE:
            disableLinkStyle = TiConvert.toBoolean(newValue);
            mProcessUpdateFlags |= TIFLAG_NEEDS_TEXT;
            break;
        case TiC.PROPERTY_AUTOCAPITALIZATION:
            if (TiC.ICS_OR_GREATER) {
                getTextView().setAllCaps(TiConvert.toBoolean(newValue));
            }
            break;
		case TiC.PROPERTY_LINE_SPACING:
			if (newValue instanceof HashMap) {
				HashMap dict = (HashMap) newValue;
				getTextView().setLineSpacing(TiConvert.toFloat(dict.get(TiC.PROPERTY_ADD), 0), TiConvert.toFloat(dict.get(TiC.PROPERTY_MULTIPLY), 0));
			}
            break;
		case TiC.PROPERTY_MINIMUM_FONT_SIZE: {
                minimumFontSize = TiConvert.toString(newValue);
                getTextView().setSingleLine(true);
                getTextView().setEllipsize(TruncateAt.END);
                getTextView().requestLayout();
                break;
            }
        default:
            super.propertySet(key, newValue, oldValue, changedProperty);
            break;
        }
    }

	@Override
	protected KrollDict dictFromMotionEvent(MotionEvent e)
	{
		KrollDict data = super.dictFromMotionEvent(e);
		CharSequence text = tv.textView.getText();
		if (text instanceof Spanned)
		{
			int[] coords = new int[2];
			getTouchView().getLocationInWindow(coords);

			final double rawx = e.getRawX();
			final double rawy = e.getRawY();
			final double x = (double) rawx - coords[0];
			final double y = (double) rawy - coords[1];
			int offset = tv.textView.getOffsetForPosition((float)x, (float)y);
			TiLinkSpan[] urls =((Spanned)text).getSpans(offset, offset + 1, TiLinkSpan.class); 
	        if (urls != null && urls.length > 0)
	        {
	            final String link = urls[0].link;
	            if (link.startsWith("tel:")) {
	                data.put("phoneNumber", link.substring(4));
	            } else {
                    data.put(TiC.PROPERTY_LINK, link);
	            }
	        }
		}
		 
		return data;
	}
	
	@Override
	protected void prepareAnimateProperty(final String key,
            final Object toValue, final HashMap properties,
            final View view, final View parentView,
            List<Animator> list, final boolean needsReverse,
            List<Animator> listReverse) {
        switch (key) {

        case TiC.PROPERTY_COLOR: {
            ObjectAnimator anim = ObjectAnimator.ofInt(this, key,
                    TiConvert.toColor(toValue));
            anim.setEvaluator(new ArgbEvaluator());
            list.add(anim);
            if (needsReverse) {
                anim = ObjectAnimator.ofInt(this, key,
                        TiConvert.toColor(properties, key));
                anim.setEvaluator(new ArgbEvaluator());
                listReverse.add(anim);
            }
            break;
        }
        default: {
             super.prepareAnimateProperty(key, toValue, properties, view, parentView, list, needsReverse, listReverse);
             break;
        }
        }
    }
	
	@Override
	protected View getTouchView()
	{
		if (tv != null) {
			return tv.textView;
		}
		return null;
	}
	
	
	@Override
	public void setReusing(boolean value)
	{
		super.setReusing(value);
		if (value)
		{
			if (tv != null) {
				tv.cancelCurrentTransition();
			}
		}
	}
	
	public void setColor(int color) {
        int currentColor = getColor();
        if (currentColor != color) {
            tv.textView.setTextColor(color);
        }
    }

    public int getColor() {
        return color;
    }
}
