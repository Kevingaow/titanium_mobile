	/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2009-2016 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */
#ifdef USE_TI_UISCROLLABLEVIEW

#import "TiUIScrollableView.h"
#import "TiUIScrollableViewProxy.h"
#import "TiUtils.h"
#import "TiViewProxy.h"
#import "TiTransition.h"

@interface TiSCrollableWrapperView: UntouchableView
@property(nonatomic,readwrite, assign)	NSInteger index;
@property(nonatomic,readwrite, assign)	BOOL attached;
@end

@implementation TiSCrollableWrapperView
@end

@interface TiUIScrollableView()
{
    TiDimension pageDimension;
    TiDimension pageOffset;
    TiTransition* _transition;
    BOOL _reverseDrawOrder;
    NSMutableArray* _wrappers;
    BOOL _updatePageDuringScroll;
    NSInteger lastPage;
    NSInteger upcomingPage;
    BOOL animating;
    BOOL verticalLayout;
    BOOL needsToRefreshScrollView;
}
@property(nonatomic,readonly)	TiUIScrollableViewProxy * proxy;
@end

@implementation TiUIScrollableView
@synthesize switchPageAnimationDuration;
#pragma mark Internal 

#ifdef TI_USE_AUTOLAYOUT
-(void)initializeTiLayoutView
{
    [super initializeTiLayoutView];
    [self setDefaultHeight:TiDimensionAutoFill];
    [self setDefaultWidth:TiDimensionAutoFill];
}
#endif

-(TiUIScrollableViewProxy *)proxy {
    return (TiUIScrollableViewProxy *)proxy;
}

-(void)dealloc
{
	RELEASE_WITH_DELEGATE(_scrollView);
	RELEASE_TO_NIL(pageControl);
    RELEASE_TO_NIL(pageControlBackgroundColor);
    RELEASE_TO_NIL(_transition);
    RELEASE_TO_NIL(_wrappers);
	RELEASE_TO_NIL(currentPageIndicatorColor);
	[super dealloc];
}

-(id)init
{
	if (self = [super init]) {
        _updatePageDuringScroll = NO;
        _reverseDrawOrder = NO;
        pageDimension = TiDimensionFromObject(@"100%");
        pageOffset = TiDimensionFromObject(@"50%");
        verticalLayout = NO;
        switchPageAnimationDuration = 250;
        cacheSize = 3;
        currentPage = -1; //so that the first change event is sent
        pagingControlHeight=20;
        pageControlBackgroundColor = nil;
        pageIndicatorColor = nil;
        currentPageIndicatorColor = nil;
        pagingControlAlpha = 1.0;
        pagingControlOnTop = NO;
        overlayEnabled = NO;
        showPageControl = YES;
        _wrappers = [[NSMutableArray alloc] init];
        animating = NO;
	}
	return self;
}

-(void)initializeState
{
    [super initializeState];
    verticalLayout = self.proxy.verticalLayout;
}

#ifndef TI_USE_AUTOLAYOUT
-(CGRect)pageControlRect
{
	
    if (!pagingControlOnTop) {
        CGRect boundsRect = [self bounds];
        if (verticalLayout) {
            return CGRectMake(boundsRect.origin.x + boundsRect.size.width - pagingControlHeight,
                              boundsRect.origin.y,
                              pagingControlHeight,
                              boundsRect.size.height);
        }
        else {
            return CGRectMake(boundsRect.origin.x,
                          boundsRect.origin.y + boundsRect.size.height - pagingControlHeight,
                          boundsRect.size.width, 
                          pagingControlHeight);
        }
    }
    else {
        CGRect boundsRect = [self bounds];
        if (verticalLayout) {
            return CGRectMake(0,0,
                              pagingControlHeight,
                              boundsRect.size.height);
        }
        else {
            return CGRectMake(0,0,
                              boundsRect.size.width,
                              pagingControlHeight);
        }
    }
    
}
#endif

-(UIPageControl*)pagecontrol 
{
	if (pageControl==nil)
	{
#ifdef TI_USE_AUTOLAYOUT
		pageControl = [[UIPageControl alloc] init];
        [pageControl setTranslatesAutoresizingMaskIntoConstraints:NO];
#else
		pageControl = [[UIPageControl alloc] initWithFrame:[self pageControlRect]];
		[pageControl setAutoresizingMask:UIViewAutoresizingFlexibleWidth|UIViewAutoresizingFlexibleTopMargin];
#endif
		[pageControl addTarget:self action:@selector(pageControlTouched:) forControlEvents:UIControlEventValueChanged];
		[pageControl setBackgroundColor:pageControlBackgroundColor];
		[pageControl setPageIndicatorTintColor:pageIndicatorColor];
		[pageControl setCurrentPageIndicatorTintColor:currentPageIndicatorColor];
		[self addSubview:pageControl];
	}
	return pageControl;
}


//-(UIView*)hitTest:(CGPoint)point withEvent:(UIEvent*)event
//{
//    UIView* child = nil;
//    if ((child = [super hitTest:point withEvent:event]) == self)
//    	return [self scrollView];
//    return child;
//}

-(UIView*)viewForHitTest
{
    return _scrollView;
}


-(NSArray*)wrappers
{
    return [NSArray arrayWithArray:_wrappers];
}

#ifdef TI_USE_AUTOLAYOUT
-(UIView*)contentView
{
    if (_contentView == nil) {
        _contentView = [[UIView alloc] init];
        [_contentView setTranslatesAutoresizingMaskIntoConstraints:NO];
    }
    return _contentView;
}
-(void)layoutSubviews
{
    [super layoutSubviews];
    if (!_constraintAdded) {
        _constraintAdded = YES;
        _scrollView = [self scrollView];
        _dotsView = [self pagecontrol];
        _contentView = [self contentView];
        NSDictionary* views =  NSDictionaryOfVariableBindings(_contentView, _scrollView, _dotsView);
        [_scrollView addConstraints:TI_CONSTR(@"V:|[_contentView(_scrollView)]|", views)];
        [_scrollView addConstraints:TI_CONSTR(@"H:|[_contentView(>=_scrollView)]|", views)];
        NSString *dotsViewHeightConstraints = [NSString stringWithFormat:@"V:[_dotsView(%f)]",pagingControlHeight];
        [self addConstraints:TI_CONSTR(dotsViewHeightConstraints, views)];
        [NSLayoutConstraint deactivateConstraints:[_dotsView constraints]];
        [self addConstraint: [NSLayoutConstraint constraintWithItem:_dotsView attribute:NSLayoutAttributeLeft relatedBy:NSLayoutRelationEqual toItem:self attribute:NSLayoutAttributeLeft multiplier:1 constant:0]];
        [self addConstraint: [NSLayoutConstraint constraintWithItem:_dotsView attribute:NSLayoutAttributeRight relatedBy:NSLayoutRelationEqual toItem:self attribute:NSLayoutAttributeRight multiplier:1 constant:0]];
        [self addConstraint: [NSLayoutConstraint constraintWithItem:_dotsView attribute:NSLayoutAttributeBottom relatedBy:NSLayoutRelationEqual toItem:self attribute:NSLayoutAttributeBottom multiplier:1 constant:0]];
    }
    
    NSArray* children = [_contentView subviews];
    NSUInteger length = [children count];
    if (length != _childrenCount) {
        _childrenCount = length;
        for (NSUInteger index = 0; index < length; index++)
        {
            TiLayoutView* child = [children objectAtIndex:index];
            [TiLayoutView removeConstraints:_contentView fromChild:child];
            
            NSDictionary* views;
            if (index == 0) {
                views =  NSDictionaryOfVariableBindings(_contentView, child, _scrollView);
                [_contentView addConstraints: TI_CONSTR(@"H:|[child]", views)];
            } else {
                UIView *prev = [children objectAtIndex:index-1];
                views =  NSDictionaryOfVariableBindings(_contentView, child, prev, _scrollView);
                [_contentView addConstraints: TI_CONSTR(@"H:[prev][child]", views)];
                
            }
            
            if (index == length-1) {
                [_contentView addConstraints:TI_CONSTR(@"H:[child]|", views)];
            }
            [_contentView addConstraints:TI_CONSTR(@"V:|[child]|", views)];
            [_scrollView addConstraints:TI_CONSTR(@"H:[child(_scrollView)]", views)];
            
        }
    }
    [_dotsView setNumberOfPages:length];
    [_dotsView setCurrentPage: _currentPage];

    [_scrollView setContentOffset:CGPointMake(_currentPage * self.frame.size.width, 0) animated:NO];
}

#define WRAP_TI_VIEW(view) \
TiLayoutView* wrapperView = [[[TiLayoutView alloc] init] autorelease]; \
[wrapperView setViewName: TI_STRING(@"scrollable.wrapper.view%lu", (unsigned long)[[self subviews] count])]; \
[wrapperView addSubview:view]; \


-(void)removeSubview:(nonnull UIView *)view
{
    [[view superview] removeFromSuperview];
}

-(void)addSubview:(nonnull UIView *)view
{
    WRAP_TI_VIEW(view)
    [[self contentView] addSubview:wrapperView];
}

-(void)insertSubview:(UIView *)view aboveSubview:(UIView *)siblingSubview
{
    WRAP_TI_VIEW(view)
    [[self contentView] insertSubview:wrapperView aboveSubview:siblingSubview];
}

-(void)insertSubview:(UIView *)view atIndex:(NSInteger)index
{
    WRAP_TI_VIEW(view)
    [[self contentView] insertSubview:wrapperView atIndex:index];
}
-(void)insertSubview:(UIView *)view belowSubview:(UIView *)siblingSubview
{
    WRAP_TI_VIEW(view)
    [[self contentView] insertSubview:wrapperView belowSubview:siblingSubview];
}
#endif


-(UIScrollView*)scrollView
{
#ifdef TI_USE_AUTOLAYOUT
	if (_scrollView==nil)
	{        
        _scrollView = [[UIScrollView alloc] init];
        [_scrollView setDelegate:self];
        [_scrollView setPagingEnabled:YES];
        [_scrollView setTranslatesAutoresizingMaskIntoConstraints:NO];
        [_scrollView setShowsHorizontalScrollIndicator:NO];
        [_scrollView setShowsVerticalScrollIndicator:NO];
        [_scrollView addSubview:[self contentView]];
        [super addSubview:_scrollView];
    }
    return _scrollView;
#else
    if (_scrollView==nil)
    {
		_scrollView = [[TDUIScrollView alloc] initWithFrame:[self bounds]];
		[_scrollView setAutoresizingMask:UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight];
		[_scrollView setPagingEnabled:YES];
		[_scrollView setDelegate:self];
		[_scrollView setBackgroundColor:[UIColor clearColor]];
		[_scrollView setShowsVerticalScrollIndicator:NO];
		[_scrollView setShowsHorizontalScrollIndicator:NO];
		[_scrollView setDelaysContentTouches:NO];
		[_scrollView setCanCancelContentTouches:YES];
		[_scrollView setScrollsToTop:NO];
        [_scrollView setClipsToBounds:NO];
        [_scrollView setTouchDelegate:self];
        [self setClipsToBounds:YES];
		[self insertSubview:_scrollView atIndex:0];
	}
#endif
	return _scrollView;
}


-(void)refreshPageControl
{
    if (showPageControl)
    {
        UIPageControl *pg = [self pagecontrol];
#ifdef TI_USE_AUTOLAYOUT
        NSInteger currentPage = _currentPage;
#else
        [pg setFrame:[self pageControlRect]];
#endif
        [pg setNumberOfPages:[[self proxy] viewCount]];
        [pg setBackgroundColor:pageControlBackgroundColor];
        [pg setCurrentPageIndicatorTintColor:currentPageIndicatorColor];
        [pg setPageIndicatorTintColor:pageIndicatorColor];
        [pg setAlpha:pagingControlAlpha];
        [pg setCurrentPage:currentPage];
        [pg setBackgroundColor:pageControlBackgroundColor];
    }
}

-(void)layoutSubviews
{
////	[super layoutSubviews];
////	[self checkBounds];
}

-(void)setView:(TiViewProxy*)viewProxy inWrapper:(TiSCrollableWrapperView *)wrapper
{
    BOOL wasAttached = [viewProxy viewAttached];
    CGRect bounds = [wrapper bounds];
    BOOL needsRefresh = !CGRectEqualToRect(bounds, [viewProxy sandboxBounds]);
    UIView* parentView = [[viewProxy view] superview];
    if (parentView != wrapper) {
        [wrapper addSubview:[viewProxy getAndPrepareViewForOpening:[wrapper bounds]]];
        wrapper.attached = YES;
    }
    if (wasAttached && needsRefresh) {
        [viewProxy refreshView];
    }
}

-(void)renderView:(TiViewProxy*)viewProxy forIndex:(int)index withRefresh:(BOOL)refresh
{
	NSInteger svSubviewsCount = [_wrappers count];
    
	if ((index < 0) || (index >= svSubviewsCount))
	{
		return;
	}

	TiSCrollableWrapperView *wrapper = [_wrappers objectAtIndex:index];
    [self setView:viewProxy inWrapper:wrapper];
}

#ifndef TI_USE_AUTOLAYOUT
-(NSRange)cachedFrames:(NSInteger)page
{
    NSInteger startPage;
    NSInteger endPage;
	NSUInteger viewsCount = [[self proxy] viewCount];
    
    // Step 1: Check to see if we're actually smaller than the cache range:
    if (cacheSize >= viewsCount) {
        startPage = 0;
        endPage = viewsCount - 1;
    }
    else {
		startPage = (page - (cacheSize - 1) / 2);
		endPage = (page + (cacheSize - 1) / 2);
		
        // Step 2: Check to see if we're rendering outside the bounds of the array, and if so, adjust accordingly.
        if (startPage < 0) {
            endPage -= startPage;
            startPage = 0;
        }
        if (endPage >= viewsCount) {
            NSInteger diffPage = endPage - viewsCount;
            endPage = viewsCount -  1;
            startPage += diffPage;
        }
		if (startPage > endPage) {
			startPage = endPage;
		}
    }
    
	return NSMakeRange(startPage, endPage - startPage + 1);
}

-(void)manageCache:(NSInteger)page withRefresh:(BOOL)refresh
{
    if ([(TiUIScrollableViewProxy *)[self proxy] viewCount] == 0) {
        return;
    }
    
    if (!configurationSet) {
        needsToRefreshScrollView = YES;
        return;
    }
    
    NSRange renderRange = [self cachedFrames:page];
	NSUInteger viewsCount = [[self proxy] viewCount];

    for (int i=0; i < viewsCount; i++) {
        TiViewProxy* viewProxy = [[self proxy] viewAtIndex:i];
        if (i >= renderRange.location && i < NSMaxRange(renderRange)) {
            [viewProxy setParentVisible:YES];
            [self renderView:viewProxy forIndex:i withRefresh:refresh];
        }
        else {
            [viewProxy setParentVisible:NO];
//            if ([viewProxy viewAttached]) {
//                [viewProxy windowWillClose];
//                [viewProxy windowDidClose];
//            }
        }
    }
}

-(void)manageCache:(NSInteger)page
{
    [self manageCache:page withRefresh:NO];
}
#endif
-(void)listenerAdded:(NSString*)event count:(NSInteger)count
{
    [super listenerAdded:event count:count];
    NSArray * childrenArray = [[[self proxy] views] retain];
    for (id child in childrenArray) {
        if ([child respondsToSelector:@selector(parentListenersChanged)]) {
            [child performSelector:@selector(parentListenersChanged)];
        }
    }
    [childrenArray release];
}

-(void)listenerRemoved:(NSString*)event count:(NSInteger)count
{
    [super listenerRemoved:event count:count];
    NSArray * childrenArray = [[[self proxy] views] retain];
    for (id child in childrenArray) {
        if ([child respondsToSelector:@selector(parentListenersChanged)]) {
            [child performSelector:@selector(parentListenersChanged)];
        }
    }
    [childrenArray release];
}

-(NSInteger)currentPage
{
	UIScrollView* scrollview = [self scrollView];
	NSInteger result = currentPage;
    if (scrollview != nil) {
        CGSize scrollFrame = [self bounds].size;
        if (scrollFrame.width != 0 && scrollFrame.height != 0) {
            float nextPageAsFloat = [self getPageFromOffset:scrollview.contentOffset];
            result = MIN(floor(nextPageAsFloat - 0.5) + 1, [[self proxy] viewCount] - 1);
        }
    }
#ifdef TI_USE_AUTOLAYOUT
	[[self pagecontrol] setCurrentPage:result];
#endif	
    return result;
}

- (void)depthSortViews
{
	UIScrollView *sv = [self scrollView];
    for (TiSCrollableWrapperView *view in _wrappers)
    {
        if (_reverseDrawOrder)
            [sv sendSubviewToBack:view];
        else
            [sv bringSubviewToFront:view];
    }
}

-(void)refreshScrollView:(BOOL)readd
{
    [self refreshScrollView:[self scrollView].bounds readd:readd];
}

-(void)resetWrapperView:(TiSCrollableWrapperView*)wrapper
{
    // we need to reset it after transitions
    wrapper.layer.transform = wrapper.layer.sublayerTransform = CATransform3DIdentity;
    wrapper.layer.hidden = NO;
    wrapper.alpha = 1;
}

-(void)refreshScrollView:(CGRect)visibleBounds readd:(BOOL)readd
{
    if (CGSizeEqualToSize(visibleBounds.size, CGSizeZero)) return;
#ifndef TI_USE_AUTOLAYOUT
	CGRect viewBounds;
	viewBounds.size.width = visibleBounds.size.width;
	viewBounds.size.height = visibleBounds.size.height;
    viewBounds.origin = CGPointMake(0, 0);
    
    if(!overlayEnabled || !showPageControl ) {
        if (verticalLayout) {
            if(pagingControlOnTop) viewBounds.origin = CGPointMake(pagingControlHeight, 0);
            viewBounds.size.width -= (showPageControl ? pagingControlHeight : 0);
        }
        else {
            if(pagingControlOnTop) viewBounds.origin = CGPointMake(0, pagingControlHeight);
            viewBounds.size.height -= (showPageControl ? pagingControlHeight : 0);
        }
    }
	UIScrollView *sv = [self scrollView];
	
    NSInteger page = [self currentPage];
    
	[self refreshPageControl];
	
	if (readd)
	{
		for (TiSCrollableWrapperView *view in _wrappers)
		{
			[view removeFromSuperview];
		}
        [_wrappers removeAllObjects];
	}
	
	NSUInteger viewsCount = [[self proxy] viewCount];
	/*
	Reset readd here since refreshScrollView is called from
	frameSizeChanged with readd false and the views might 
	not yet have been added on first launch
	*/
	readd = ([_wrappers count] == 0);
	
	for (int i=0;i<viewsCount;i++)
	{
        if (verticalLayout) {
            viewBounds.origin.y = i*viewBounds.size.height;
        }
        else {
            viewBounds.origin.x = i*viewBounds.size.width;
        }
		
		if (readd)
		{
			TiSCrollableWrapperView *view = [[TiSCrollableWrapperView alloc] initWithFrame:viewBounds];
            view.layer.rasterizationScale = [[UIScreen mainScreen] scale];
            view.index = i;
            view.attached = NO;
			[sv addSubview:view];
            [_wrappers addObject:view];
			[view release];
		}
		else 
		{
			TiSCrollableWrapperView *view = [_wrappers objectAtIndex:i];
			[sv addSubview:view];
            [self resetWrapperView:view];
			view.frame = viewBounds;
		}
	}
    if (readd && _transition) {
        [self depthSortViews];
    }
    
	[self manageCache:page];
	
	CGSize contentBounds = CGSizeMake(viewBounds.size.width, viewBounds.size.height);
    if (verticalLayout) {
        contentBounds.height *= viewsCount;
    }
    else {
        contentBounds.width *= viewsCount;
    }
	
	[sv setContentSize:CGSizeMake(floorf(contentBounds.width), floorf(contentBounds.height))];
    [UIView performWithoutAnimation:^{
        [self didScroll];
    }];
#endif
}

-(void) updateScrollViewFrame:(CGRect)visibleBounds
{
    if (verticalLayout) {
        CGFloat pageWidth = TiDimensionCalculateValue(pageDimension, visibleBounds.size.height);
        CGRect bounds = visibleBounds;
        bounds.size.height = pageWidth;
        CGFloat offset = TiDimensionCalculateValue(pageOffset, visibleBounds.size.height - bounds.size.height);
        bounds.origin.y = offset;
        [[self scrollView] setFrame:bounds];
    } else {
        CGFloat pageWidth = TiDimensionCalculateValue(pageDimension, visibleBounds.size.width);
        CGRect bounds = visibleBounds;
        bounds.size.width = pageWidth;
        CGFloat offset = TiDimensionCalculateValue(pageOffset, visibleBounds.size.width - bounds.size.width);
        bounds.origin.x = offset;
        [[self scrollView] setFrame:bounds];
    }
}


#ifndef TI_USE_AUTOLAYOUT
// We have to cache the current page because we need to scroll to the new (logical) position of the view
// within the scrollable view.  Doing so, if we're resizing to a SMALLER frame, causes a content offset
// reset internally, which screws with the currentPage number (since -[self scrollViewDidScroll:] is called).
// Looks a little ugly, though...
//-(void)setFrame:(CGRect)frame_
//{
//    lastPage = [self currentPage];
//    enforceCacheRecalculation = YES;
//    [super setFrame:frame_];
////    [self updateScrollViewFrame:frame_];
//    [self setCurrentPage_:[NSNumber numberWithInt:lastPage]];
//    enforceCacheRecalculation = NO;
//}


-(void)setBounds:(CGRect)bounds_
{
    lastPage = currentPage;
    enforceCacheRecalculation = YES;
    [super setBounds:bounds_];
}
-(void)frameSizeChanged:(CGRect)frame bounds:(CGRect)visibleBounds
{
    if (CGSizeEqualToSize(visibleBounds.size, CGSizeZero)) return;
	
    [self updateScrollViewFrame:visibleBounds];
    [self setCurrentPage_:NUMINTEGER(lastPage)];
    enforceCacheRecalculation = NO;
    [self refreshScrollView:NO];
    [self setContentOffsetForPage:currentPage animated:NO];
    [self manageCache:[self currentPage]];
	
    //To make sure all subviews are properly resized.
//    UIScrollView *sv = [self scrollView];
//    for(UIView *view in _wrappers){
//        for (TiUIView *sView in [view subviews]) {
//                [sView checkBounds];
//        }
//    }
    
    [super frameSizeChanged:frame bounds:visibleBounds];
}
#endif

-(void)configurationStart
{
    [super configurationStart];
    needsToRefreshScrollView = NO;
}

-(void)configurationSet
{
    [super configurationSet];
    
    if (needsToRefreshScrollView)
    {
        [self refreshScrollView:NO];
//        [self manageCache:[self currentPage]];
    }
}

#pragma mark Public APIs

-(void)setCacheSize_:(id)args
{
#ifndef TI_USE_AUTOLAYOUT
    ENSURE_SINGLE_ARG(args, NSNumber);
    int newCacheSize = [args intValue];
    if (newCacheSize < 1) {
        // WHAT.  Let's make it something sensible.
        newCacheSize = 1;
    }
    if (newCacheSize % 2 == 0) {
        DebugLog(@"[WARN] Even scrollable cache size %d; setting to %d", newCacheSize, newCacheSize-1);
        newCacheSize -= 1;
    }
    cacheSize = newCacheSize;
    [self manageCache:[self currentPage]];
#endif
}

-(void)setPageWidth_:(id)args
{
    pageDimension = TiDimensionFromObject(args);
    if ((_scrollView!=nil) && ([[_scrollView subviews] count]>0)) {
        //No need to readd. Just set up the correct frame bounds
        [self refreshScrollView:NO];
    }
}

-(void)setViews_:(id)args
{
	if ((_scrollView!=nil) && ([_scrollView subviews]>0))
	{
        [self updateCurrentPage:0];
		[self refreshScrollView:YES];
	}
}

-(void)setShowPagingControl_:(id)args
{
	showPageControl = [TiUtils boolValue:args];
    
	if (pageControl!=nil)
	{
		if (showPageControl==NO)
		{
            [pageControl setHidden:YES];
        } else {
            [pageControl setHidden:NO];
        }
	}

    if ((_scrollView!=nil) && ([[_scrollView subviews] count]>0)) {
        //No need to readd. Just set up the correct frame bounds
        [self refreshScrollView:NO];
    }
	
}

-(void)setPagingControlHeight_:(id)args
{
	pagingControlHeight = [TiUtils floatValue:args def:20.0];
	if (pagingControlHeight < 5.0)
	{
		pagingControlHeight = 20.0;
	}
    
    if (showPageControl && (_scrollView!=nil) && ([[_scrollView subviews] count]>0)) {
        //No need to readd. Just set up the correct frame bounds
        [self refreshScrollView:NO];
    }
}

-(void)setPagingControlColor_:(id)args
{
    TiColor* val = [TiUtils colorValue:args];
    if (val != nil) {
        RELEASE_TO_NIL(pageControlBackgroundColor);
        pageControlBackgroundColor = [[val _color] retain];
        if (showPageControl && (_scrollView!=nil) && ([_wrappers count]>0)) {
            [[self pagecontrol] setBackgroundColor:pageControlBackgroundColor];
        }
    }
}
-(void)setPageIndicatorColor_:(id)args
{
    TiColor* val = [TiUtils colorValue:args];
    if (val != nil) {
        RELEASE_TO_NIL(pageIndicatorColor);
        pageIndicatorColor = [[val _color] retain];
        if (showPageControl && (_scrollView!=nil) && ([[_scrollView subviews] count]>0)) {
            [[self pagecontrol] setPageIndicatorTintColor:pageIndicatorColor];
        }
    }
}

-(void)setCurrentPageIndicatorColor_:(id)args
{
    TiColor* val = [TiUtils colorValue:args];
    if (val != nil) {
        RELEASE_TO_NIL(currentPageIndicatorColor);
        currentPageIndicatorColor = [[val _color] retain];
        if (showPageControl && (_scrollView!=nil) && ([[_scrollView subviews] count]>0)) {
            [[self pagecontrol] setCurrentPageIndicatorTintColor:currentPageIndicatorColor];
        }
    }
}

-(void)setPagingControlAlpha_:(id)args
{
    pagingControlAlpha = [TiUtils floatValue:args def:1.0];
    if(pagingControlAlpha > 1.0){
        pagingControlAlpha = 1;
    }
    if(pagingControlAlpha < 0.0 ){
        pagingControlAlpha = 0;
    }
    if (showPageControl && (_scrollView!=nil) && ([_wrappers count] > 0)) {
        [[self pagecontrol] setAlpha:pagingControlAlpha];
    }
    
}

-(void)setPagingControlOnTop_:(id)args
{
   pagingControlOnTop = [TiUtils boolValue:args def:NO];
    if (showPageControl && (_scrollView!=nil) && ([[_scrollView subviews] count] > 0)) {
        //No need to readd. Just set up the correct frame bounds
        [self refreshScrollView:NO];
    }
}

-(void)setOverlayEnabled_:(id)args
{
    overlayEnabled = [TiUtils boolValue:args def:NO];
    if (showPageControl && (_scrollView!=nil) && ([_wrappers count] > 0)) {
        //No need to readd. Just set up the correct frame bounds
        [self refreshScrollView:NO];
    }
}

-(void)setContentOffsetForPage:(NSInteger)pageNumber animated:(BOOL)animated
{
    CGPoint offset;
    if (verticalLayout) {
        float pageHeight = [_scrollView bounds].size.height;
        offset = CGPointMake(0, pageHeight * pageNumber);
    }
    else {
        float pageWidth = [_scrollView bounds].size.width;
        offset = CGPointMake(pageWidth * pageNumber, 0);
    }
    upcomingPage = pageNumber;
    [_scrollView setContentOffset:offset animated:animated];
    [self didScroll];
}

-(NSInteger)pageNumFromArg:(id)args
{
	NSInteger pageNum = 0;
	if ([args isKindOfClass:[TiViewProxy class]])
	{
		[[self proxy] lockViews];
		pageNum = [[[self proxy] viewProxies] indexOfObject:args];
		[[self proxy] unlockViews];
	}
	else
	{
        pageNum = fmax(0, fmin([[self proxy] viewCount] - 1, [TiUtils intValue:args]));
	}
	
	return pageNum;
}

-(void)scrollToView:(id)args
{
    id data = nil;
    NSNumber* anim = nil;
    BOOL animated = YES;
    ENSURE_ARG_AT_INDEX(data, args, 0, NSObject);
    ENSURE_ARG_OR_NIL_AT_INDEX(anim, args, 1, NSNumber);
	NSInteger pageNum = [self pageNumFromArg:data];
    if (pageNum == currentPage) {
        return;
    }
	if (anim != nil)
		animated = [anim boolValue];
    
    [self manageCache:pageNum];
    
    if (animated)
    {
        upcomingPage = pageNum;
        if (_transition != nil){
            [self transformViews];
        }
        animating = YES;
        CGFloat duration = switchPageAnimationDuration/1000;
        [CATransaction begin];
        
        [CATransaction setAnimationDuration:switchPageAnimationDuration/1000];
        [CATransaction setAnimationTimingFunction:[CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionLinear]];
        [UIView animateWithDuration:duration
                              delay:0.00
                            options:UIViewAnimationOptionBeginFromCurrentState | UIViewAnimationOptionCurveLinear
                         animations:^{
                             
                             [self setContentOffsetForPage:pageNum animated:NO];

                         }
                         completion:^(BOOL finished){
                             animating = NO;
                             [self scrollViewDidEndDecelerating:[self scrollView]];
                            } ];
        [CATransaction commit];
    }
    else{
        [self setContentOffsetForPage:pageNum animated:NO];
        [self updateCurrentPage:pageNum andPageControl:YES];
    }
}

-(void)moveNext:(id)args
{
	NSInteger page = [self currentPage];
	NSInteger pageCount = [[self proxy] viewCount];

	if (page < pageCount-1)
	{
		NSArray* scrollArgs = [NSArray arrayWithObjects:NUMINTEGER(page+1), args, nil];
		[self scrollToView:scrollArgs];
	}
}

-(void)movePrevious:(id)args
{
	NSInteger page = [self currentPage];

	if (page > 0)
	{
		NSArray* scrollArgs = [NSArray arrayWithObjects:NUMINTEGER(page-1), args, nil];
		[self scrollToView:scrollArgs];
	}
}

-(void)updateCurrentPage:(NSInteger)newPage
{
    [self updateCurrentPage:newPage andPageControl:YES];
}

-(void)updateCurrentPage:(NSInteger)newPage andPageControl:(BOOL)updatePageControl
{
    if (newPage == currentPage) return;
    [self.proxy replaceValue:NUMINTEGER(newPage) forKey:@"currentPage" notification:NO];
    NSInteger oldPage = currentPage;
    currentPage = newPage;
    upcomingPage = currentPage;
    [self manageCache:currentPage];
    if (updatePageControl) {
        [pageControl setCurrentPage:newPage];
    }
    if ([self.proxy _hasListeners:@"change" checkParent:NO])
	{
		[self.proxy fireEvent:@"change" withObject:[NSDictionary dictionaryWithObjectsAndKeys:
                                                    NUMINTEGER(newPage),@"currentPage",
                                                    NUMINTEGER(oldPage),@"oldPage",
                                                    [[self proxy] viewAtIndex:oldPage],@"oldView",
                                                   [[self proxy] viewAtIndex:newPage],@"view",nil] propagate:NO checkForListener:NO];
	}
}

-(void)addView:(id)viewproxy
{
#ifndef TI_USE_AUTOLAYOUT
	[self refreshScrollView:[self bounds] readd:YES];
#else
	[self addSubview:[viewproxy view]];
	[self layoutSubviews];
	[self refreshPageControl];
#endif
}

-(void)removeView:(id)args
{
	UIPageControl* pageControl = [self pagecontrol];
//	NSInteger currentPage = _currentPage;
	NSInteger page = [self currentPage];
	NSUInteger pageCount = [[self proxy] viewCount];
	if (page==pageCount)
	{
        [self updateCurrentPage:pageCount-1];
	}
#ifndef TI_USE_AUTOLAYOUT
	[self refreshScrollView:[self bounds] readd:YES];
#else
	TiViewProxy *viewProxy = (TiViewProxy *)args;
	[self removeSubview:[viewProxy view]];
	[self refreshPageControl];
#endif
}


-(void)setCurrentPage:(id)page animated:(NSNumber*)animate {
//    NSInteger currentPage = _currentPage;
//    int newPage = [TiUtils intValue:page];
//    NSUInteger viewsCount = [[self proxy] viewCount];
    
    NSInteger newPage = [self pageNumFromArg:page];
    if (newPage != currentPage)
    {
        [self setContentOffsetForPage:newPage animated:NO];
        lastPage = newPage;
        [self updateCurrentPage:newPage];
        
        [self manageCache:newPage];
        [self didScroll];
        
    }
}
-(void)setCurrentPage_:(id)page
{
    [self setCurrentPage:page animated:@(NO)];
}
-(void)setScrollDirection_:(id)args
{
    verticalLayout = ([args isKindOfClass:[NSString class]] && [args caseInsensitiveCompare:@"vertical"]== NSOrderedSame);
    [self refreshScrollView:NO];
}

-(void)setTransition_:(id)value
{
    
    UIScrollView* sv = [self scrollView];
    ENSURE_SINGLE_ARG_OR_NIL(value, NSDictionary)
    RELEASE_TO_NIL(_transition);
    _transition = [[TiTransitionHelper transitionFromArg:value containerView:sv] retain];
    if (_transition) {
        _reverseDrawOrder = [_transition needsReverseDrawOrder];
        [_transition prepareViewHolder:sv];
    }
	[self refreshScrollView:YES];
	[self depthSortViews];
}


#pragma mark Rotation

-(void)manageRotation
{
    if ([_scrollView isDecelerating] || [_scrollView isDragging]) {
        rotatedWhileScrolling = YES;
    }
}

#pragma mark Delegate calls

-(void)pageControlTouched:(id)sender
{
//	NSInteger currentPage = _currentPage;
	NSInteger pageNum = [(UIPageControl *)sender currentPage];
    [self setContentOffsetForPage:pageNum animated:YES];
	handlingPageControlEvent = YES;
	
    lastPage = pageNum;
    [self updateCurrentPage:pageNum];
	[self manageCache:pageNum];
    [self fireScrollEvent:@"click" forScrollView:_scrollView withAdditionalArgs:nil];
}


-(CGFloat)getPageFromOffset:(CGPoint)offset
{
    float nextPageAsFloat;
    if (verticalLayout) {
        CGFloat pageHeight = _scrollView.frame.size.height;
        nextPageAsFloat = ((offset.y - pageHeight / 2) / pageHeight) + 0.5;
    }
    else {
        CGFloat pageWidth = _scrollView.frame.size.width;
        nextPageAsFloat = ((offset.x - pageWidth / 2) / pageWidth) + 0.5;
    }
    return nextPageAsFloat;
}

- (void)transformItemView:(TiSCrollableWrapperView *)view withCurrentPage:(CGFloat)currentPageAsFloat
{
    //calculate offset
//    CGRect bounds = view.bounds;
    view.layer.transform = CATransform3DIdentity;
    NSInteger index = view.index;
    CGFloat offset = index - currentPageAsFloat;
    CGFloat realOffset = offset;
    if (currentPage != upcomingPage) {
        if (index != upcomingPage && index != currentPage) {
            realOffset = -2; // for hidden
        } else {
            CGFloat delta = upcomingPage - currentPage;
            realOffset /= delta;
        }
    }
    
    [_transition transformView:view withPosition:realOffset];
    CATransform3D transform = view.layer.transform;
    if (verticalLayout) {
        CGFloat translateY = -offset * view.bounds.size.height;
        transform = CATransform3DConcat(transform, CATransform3DMakeTranslation(0, translateY,0));
        
    }
    else {
        CGFloat translateX = -offset * view.bounds.size.width;
        transform = CATransform3DConcat(transform, CATransform3DMakeTranslation(translateX, 0,0));
    }
    view.layer.transform = transform;
}

- (void)transformViews
{
    int index = 0;
    float currentPageAsFloat = [self getPageFromOffset:_scrollView.contentOffset];
    for (TiSCrollableWrapperView* view in [_scrollView subviews]) {
        if (view.attached) {
            [self transformItemView:view withCurrentPage:currentPageAsFloat];
		}
        index ++ ;
    }
}

#pragma mark -
#pragma mark Scrolling

- (void)didScroll
{
    if (_transition != nil){
        [self transformViews];
    }
}

-(void)fireEventWithData:(NSString*)event andPageAsFloat:(CGFloat)pageAsFloat propagate:(BOOL)propagate
{
    if ([self.proxy _hasListeners:event checkParent:propagate])
	{
		[self.proxy fireEvent:event withObject:[NSDictionary dictionaryWithObjectsAndKeys:
                                                    NUMINTEGER(currentPage), @"currentPage",
                                                    NUMFLOAT(pageAsFloat), @"currentPageAsFloat",
                                                    [[self proxy] viewAtIndex:currentPage], @"view", nil] propagate:propagate];
        
	}
}

- (NSMutableDictionary *) eventObjectForScrollView: (UIScrollView *) scrollView
{
    float nextPageAsFloat = [self getPageFromOffset:_scrollView.contentOffset];
    NSMutableDictionary* eventArgs = [super eventObjectForScrollView:scrollView];
    [eventArgs setValue:@(currentPage) forKey:@"currentPage"];
    [eventArgs setValue:@(nextPageAsFloat) forKey:@"currentPageAsFloat"];
    [eventArgs setValue:[[self proxy] viewAtIndex:currentPage] forKey:@"view"];
    return eventArgs;
}


-(void)scrollViewDidEndScrollingAnimation:(UIScrollView *)scrollView
{
    _updatePageDuringScroll = NO;
}

- (void)scrollViewDidScroll:(UIScrollView *)scrollView
{
//    if (animating) return;

    //switch page control at 50% across the center - this visually looks better
    NSInteger page = currentPage;
    float nextPageAsFloat = [self getPageFromOffset:_scrollView.contentOffset];
    int nextPage = MIN(floor(nextPageAsFloat - 0.5) + 1, [[self proxy] viewCount] - 1);
    if (page != nextPage) {
        NSInteger curCacheSize = cacheSize;
        NSInteger minCacheSize = cacheSize;
        if (enforceCacheRecalculation) {
            minCacheSize = ABS(page - nextPage)*2 + 1;
            if (minCacheSize < cacheSize) {
                minCacheSize = cacheSize;
            }
        }
        cacheSize = minCacheSize;
        if (_updatePageDuringScroll)  {
            [self updateCurrentPage:nextPage];
        } else {
            pageChanged = YES;
        }
        cacheSize = curCacheSize;
    }
    [self didScroll];
    [super scrollViewDidScroll:scrollView];
}

- (void)scrollViewWillBeginDragging:(UIScrollView *)scrollView
{
    _updatePageDuringScroll = YES;
    if (pageChanged) {
        [self manageCache:[self currentPage]];
    }
    [super scrollViewWillBeginDragging:scrollView];
}

- (void)scrollViewDidEndDragging:(UIScrollView *)scrollView willDecelerate:(BOOL)decelerate
{
    _updatePageDuringScroll = NO;
    //Since we are now managing cache at end of scroll, ensure quick scroll is disabled to avoid blank screens.
    if (pageChanged) {
        [self manageCache:[self currentPage]];
        [_scrollView setUserInteractionEnabled:!decelerate];
#ifndef TI_USE_AUTOLAYOUT
    }
    [super scrollViewDidEndDragging:scrollView willDecelerate:decelerate];
#endif
}

- (void)scrollViewDidEndDecelerating:(UIScrollView *)scrollView
{
    _updatePageDuringScroll = NO;
    if (rotatedWhileScrolling) {
        [self setContentOffsetForPage:[self currentPage] animated:YES];
        rotatedWhileScrolling = NO;
    }
    
    // At the end of scroll animation, reset the boolean used when scrolls originate from the UIPageControl
    NSInteger pageNum = [self currentPage];
    handlingPageControlEvent = NO;
    
    lastPage = pageNum;
    upcomingPage = pageNum;
    [self updateCurrentPage:pageNum];
    
    [self manageCache:currentPage];
    pageChanged = NO;
    [_scrollView setUserInteractionEnabled:YES];
    [self didScroll];

    [super scrollViewDidEndDecelerating:scrollView];
}

//- (BOOL)scrollViewShouldScrollToTop:(UIScrollView *)scrollView
//{
//    return [super scrollViewShouldScrollToTop:scrollView];
//}
//
//- (void)scrollViewDidScrollToTop:(UIScrollView *)scrollView
//{
//    return [super scrollViewDidScrollToTop:scrollView];
//}

#pragma mark Keyboard delegate stuff

-(void)keyboardDidShowAtHeight:(CGFloat)keyboardTop
{
    CGRect minimumContentRect = [_scrollView bounds];
    InsetScrollViewForKeyboard(_scrollView,keyboardTop,minimumContentRect.size.height + minimumContentRect.origin.y);
}

-(void)scrollToShowView:(UIView *)firstResponderView withKeyboardHeight:(CGFloat)keyboardTop
{
    if ([_scrollView isScrollEnabled]) {
        CGRect minimumContentRect = [_scrollView bounds];
        
        CGRect responderRect = [self convertRect:[firstResponderView bounds] fromView:firstResponderView];
        CGPoint offsetPoint = [_scrollView contentOffset];
        responderRect.origin.x += offsetPoint.x;
        responderRect.origin.y += offsetPoint.y;
        
        OffsetScrollViewForRect(_scrollView,keyboardTop,minimumContentRect.size.height + minimumContentRect.origin.y,responderRect);
    }
}


@end

#endif
