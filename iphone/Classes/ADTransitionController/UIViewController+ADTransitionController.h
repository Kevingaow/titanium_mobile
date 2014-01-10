//
//  UIViewController+ADTransitionController.h
//  Transition
//
//  Created by Romain Goyet on 22/02/11.
//  Copyright 2011 Applidium. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "ADTransitionController.h"

@class ADTransitionController, ADTransition;
@interface UIViewController (ADTransitionController)
- (ADTransitionController *)transitionController;
//- (void)setTransition:(ADTransition *)transition;
@end
