//
//  DirectionPanGestureRecognizer.m
//  MapMe
//
//  Created by Martin Guillon on 26/07/2015.
//
//

#import "DirectionPanGestureRecognizer.h"
#import <UIKit/UIGestureRecognizerSubclass.h>

int const static kDirectionPanThreshold = 5;

@implementation DirectionPanGestureRecognizer {
    BOOL _drag;
    int _moveX;
    int _moveY;
    DirectionPangestureRecognizerDirection _direction;
}


@synthesize direction = _direction;

- (id)init
{
    self = [super init];
    if (self) {
        _direction = DirectionPangestureRecognizerAll;
    }
    return self;
}

- (void)touchesMoved:(NSSet *)touches withEvent:(UIEvent *)event {
    [super touchesMoved:touches withEvent:event];
    if (self.state == UIGestureRecognizerStateFailed) return;
    CGPoint nowPoint = [[touches anyObject] locationInView:self.view];
    CGPoint prevPoint = [[touches anyObject] previousLocationInView:self.view];
    _moveX += prevPoint.x - nowPoint.x;
    _moveY += prevPoint.y - nowPoint.y;
    if (!_drag) {
        if (abs(_moveX) > kDirectionPanThreshold) {
            if (_direction == DirectionPangestureRecognizerVertical) {
                self.state = UIGestureRecognizerStateFailed;
            }else {
                _drag = YES;
            }
        }else if (abs(_moveY) > kDirectionPanThreshold) {
            if (_direction == DirectionPanGestureRecognizerHorizontal) {
                self.state = UIGestureRecognizerStateFailed;
            }else {
                _drag = YES;
            }
        }
    }
}

- (void)reset {
    [super reset];
    _drag = NO;
    _moveX = 0;
    _moveY = 0;
}

@end