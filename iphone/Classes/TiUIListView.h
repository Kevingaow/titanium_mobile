/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2013 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */
#ifdef USE_TI_UILISTVIEW

#import "TiScrollingView.h"
#import "TiUIListViewProxy.h"
#import "MGSwipeTableCell.h"
#import "TiTableView.h"

#if IS_XCODE_8
// Add support for iOS 10 table-view prefetching
@interface TiUIListView : TiScrollingView <MGSwipeTableCellDelegate, UITableViewDelegate, UITableViewDataSource, UITableViewDataSourcePrefetching , UIGestureRecognizerDelegate, UISearchBarDelegate, UISearchDisplayDelegate, TiScrolling, TiProxyObserver, TiUIListViewDelegateView >
#else
@interface TiUIListView : TiScrollingView <MGSwipeTableCellDelegate, UITableViewDelegate, UITableViewDataSource, UIGestureRecognizerDelegate, UISearchBarDelegate, UISearchDisplayDelegate, TiScrolling, TiProxyObserver, TiUIListViewDelegateView >
#endif

#pragma mark - Private APIs

@property (nonatomic, readonly) TiTableView *tableView;
@property (nonatomic, readonly) BOOL isSearchActive;
@property (nonatomic, readonly) BOOL editing;

- (void)setContentInsets_:(id)value withObject:(id)props;
- (void)deselectAll:(BOOL)animated;
- (void)updateIndicesForVisibleRows;

+ (UITableViewRowAnimation)animationStyleForProperties:(NSDictionary*)properties;
-(BOOL)shouldHighlightCurrentListItem;
- (NSIndexPath *) nextIndexPath:(NSIndexPath *) indexPath;
-(NSMutableArray*)visibleCellsProxies;
- (void)selectItem:(NSIndexPath*)indexPath animated:(BOOL)animated;
- (void)deselectItem:(NSIndexPath*)indexPath animated:(BOOL)animated;

@end

#endif
