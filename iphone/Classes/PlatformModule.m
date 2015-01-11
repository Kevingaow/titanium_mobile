/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2009-2014 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */
#ifdef USE_TI_PLATFORM

#import "PlatformModule.h"
#import "TiApp.h"

#import <sys/sysctl.h>  
#import <mach/mach.h>
#import <sys/utsname.h>

@implementation PlatformModule

@synthesize name, model, version, architecture, processorCount, username, ostype, availableMemory;

#pragma mark Internal

-(id)init
{
	if (self = [super init])
	{
		UIDevice *theDevice = [UIDevice currentDevice];
		name = [[theDevice systemName] retain];
		version = [[theDevice systemVersion] retain];
		processorCount = [[NSNumber numberWithInt:1] retain];
		username = [[theDevice name] retain];
#ifdef __LP64__
		ostype = [@"64bit" retain];
#else
		ostype = [@"32bit" retain];
#endif
		
		if ([TiUtils isIPad])
		{
			// ipad is a constant for Ti.Platform.osname
			[self replaceValue:@"ipad" forKey:@"osname" notification:NO];
		}
		else 
		{
			// iphone is a constant for Ti.Platform.osname
			[self replaceValue:@"iphone" forKey:@"osname" notification:NO]; 
		}
		
		NSString *themodel = [theDevice model];
		
		// attempt to determine extended phone info
		struct utsname u;
		uname(&u);
		
		// detect iPhone 3G model
		if (!strcmp(u.machine, "iPhone1,2")) 
		{
			model = [[NSString stringWithFormat:@"%@ 3G",themodel] retain];
		}
		// detect iPhone 3Gs model
		else if (!strcmp(u.machine, "iPhone2,1")) 
		{
			model = [[NSString stringWithFormat:@"%@ 3GS",themodel] retain];
		}
		// detect iPhone 4 model
		else if (!strcmp(u.machine, "iPhone3,1")) 
		{
			model = [[NSString stringWithFormat:@"%@ 4",themodel] retain];
		}
		// detect iPod Touch 2G model
		else if (!strcmp(u.machine, "iPod2,1")) 
		{
			model = [[NSString stringWithFormat:@"%@ 2G",themodel] retain];
		}
		// detect iPad 2 model
		else if (!strcmp(u.machine, "iPad2,1")) 
		{
			model = [[NSString stringWithFormat:@"%@ 2",themodel] retain];
		}
		// detect simulator for i386
		else if (!strcmp(u.machine, "i386")) 
		{
			model = [@"Simulator" retain];
		}
		// detect simulator for x86_64
		else if (!strcmp(u.machine, "x86_64")) 
		{
			model = [@"Simulator" retain];
		}
		else 
		{
			model = [[NSString alloc] initWithUTF8String:u.machine];
		}
		architecture = [[TiUtils currentArchitecture] retain];

		// needed for platform displayCaps orientation to be correct
		[[UIDevice currentDevice] beginGeneratingDeviceOrientationNotifications];
	}
	return self;
}

-(void)dealloc
{
	RELEASE_TO_NIL(name);
	RELEASE_TO_NIL(model);
	RELEASE_TO_NIL(version);
	RELEASE_TO_NIL(architecture);
	RELEASE_TO_NIL(processorCount);
	RELEASE_TO_NIL(username);
	RELEASE_TO_NIL(ostype);
	RELEASE_TO_NIL(availableMemory);
	RELEASE_TO_NIL(capabilities);
	[super dealloc];
}

-(NSString*)apiName
{
    return @"Ti.Platform";
}

-(void)_listenerAdded:(NSString *)type count:(NSInteger)count
{
	if (count == 1 && [type isEqualToString:@"battery"])
	{
		UIDevice *device = [UIDevice currentDevice];
		// set a flag to temporarily turn on battery enablement
		if (batteryEnabled==NO && device.batteryMonitoringEnabled==NO)
		{
			batteryEnabled = YES;
			[device setBatteryMonitoringEnabled:YES];
		}
		WARN_IF_BACKGROUND_THREAD_OBJ;	//NSNotificationCenter is not threadsafe!
		[[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(batteryStateChanged:) name:UIDeviceBatteryStateDidChangeNotification object:device];
		[[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(batteryStateChanged:) name:UIDeviceBatteryLevelDidChangeNotification object:device];
	}
}

-(void)_listenerRemoved:(NSString *)type count:(NSInteger)count
{
	if (count == 0 && [type isEqualToString:@"battery"])
	{
		UIDevice *device = [UIDevice currentDevice];
		if (batteryEnabled)
		{
			[device setBatteryMonitoringEnabled:NO];
		}
		WARN_IF_BACKGROUND_THREAD_OBJ;	//NSNotificationCenter is not threadsafe!
		[[NSNotificationCenter defaultCenter] removeObserver:self name:UIDeviceBatteryStateDidChangeNotification object:device];
		[[NSNotificationCenter defaultCenter] removeObserver:self name:UIDeviceBatteryLevelDidChangeNotification object:device];
	}
}

#pragma mark Public APIs

-(NSString*)runtime
{
	return @"javascriptcore";
}

-(NSString*)manufacturer
{
    return @"apple";
}


-(id)fullInfo
{
    return @{
        @"dpi": [[self displayCaps] dpi],
        @"osname": [self valueForKey:@"osname"],
        @"density": [[self displayCaps] density],
        @"version": [self version],
        @"name": [self name],
        @"ostype": [self ostype],
        @"model": [self model],
        @"locale": [self locale],
        @"id": [self id],
        @"width": [[self displayCaps] platformWidth],
        @"height": [[self displayCaps] platformHeight]
    };
}

-(NSString*)locale
{
	// this will return the locale that the user has set the phone in
	// not the region where the phone is
	NSUserDefaults* defs = [NSUserDefaults standardUserDefaults];
	NSArray* languages = [defs objectForKey:@"AppleLanguages"];
	return [languages count] > 0 ? [languages objectAtIndex:0] : @"en";
}

-(NSString*)macaddress
{
    return [TiUtils appIdentifier];
}

-(id)id
{
    return [TiUtils appIdentifier];
}

- (NSString *)createUUID:(id)args
{
	return [TiUtils createUUID];
}

-(NSNumber*) is24HourTimeFormat: (id) unused
{
	NSDateFormatter *dateFormatter = [[NSDateFormatter alloc] init];
	[dateFormatter setLocale:[NSLocale currentLocale]];
	[dateFormatter setTimeStyle:NSDateFormatterShortStyle];
	NSString *dateInStringForm = [dateFormatter stringFromDate:[NSDate date]];
	NSRange amRange = [dateInStringForm rangeOfString:[dateFormatter AMSymbol]];
	NSRange pmRange = [dateInStringForm rangeOfString:[dateFormatter PMSymbol]];
	[dateFormatter release];
	return NUMBOOL(amRange.location == NSNotFound && pmRange.location == NSNotFound);
	
}


- (NSNumber*)availableMemory
{
	vm_statistics_data_t vmStats;
	mach_msg_type_number_t infoCount = HOST_VM_INFO_COUNT;
	kern_return_t kernReturn = host_statistics(mach_host_self(), HOST_VM_INFO, (host_info_t)&vmStats, &infoCount);
	
	if (kernReturn != KERN_SUCCESS) {
		return [NSNumber numberWithDouble:-1];
	}
	
	return [NSNumber numberWithDouble:((vm_page_size * vmStats.free_count) / 1024.0) / 1024.0];
}

- (NSNumber *)openURL:(NSArray*)args
{
	NSString *newUrlString = [args objectAtIndex:0];
	NSURL * newUrl = [TiUtils toURL:newUrlString proxy:self];
	BOOL result = NO;
	if (newUrl != nil)
	{
		[[UIApplication sharedApplication] openURL:newUrl];
	}
	
	return [NSNumber numberWithBool:result];
}

-(id)canOpenURL:(id)arg
{
	ENSURE_SINGLE_ARG(arg, NSObject);
    if ([arg isKindOfClass:[NSArray class]]) {
        for (int i =0; i < [arg count]; i++) {
            NSURL* url = [TiUtils toURL:[arg objectAtIndex:i] proxy:self];
            if ([[UIApplication sharedApplication] canOpenURL:url]) {
                return @(i);
            }
        }
        return @(-1);
    }
    else {
        NSURL* url = [TiUtils toURL:arg proxy:self];
        return NUMBOOL([[UIApplication sharedApplication] canOpenURL:url]);
    }
}

-(TiPlatformDisplayCaps*)displayCaps
{
	if (capabilities == nil)
	{
		return [[[TiPlatformDisplayCaps alloc] _initWithPageContext:[self executionContext]] autorelease];
	}
	return capabilities;
}

-(void)setBatteryMonitoring:(NSNumber *)yn
{
	[[UIDevice currentDevice] setBatteryMonitoringEnabled:[TiUtils boolValue:yn]];
}

-(NSNumber*)batteryMonitoring
{
	return NUMBOOL([UIDevice currentDevice].batteryMonitoringEnabled);
}

-(NSNumber*)batteryState
{
	return NUMINT([[UIDevice currentDevice] batteryState]);
}

-(NSNumber*)batteryLevel
{
	return NUMFLOAT([[UIDevice currentDevice] batteryLevel]);
}

-(TiBlob*)splashImageForCurrentOrientation {
    UIUserInterfaceIdiom deviceIdiom = [[UIDevice currentDevice] userInterfaceIdiom];
    UIUserInterfaceIdiom imageIdiom;
    UIDeviceOrientation imageOrientation;
    UIImage * defaultImage = [[[TiApp app] controller] defaultImageForOrientation:
                              [[UIDevice currentDevice] orientation]
                                         resultingOrientation:&imageOrientation idiom:&imageIdiom];
    return [[[TiBlob alloc] initWithImage:defaultImage] autorelease];
}


MAKE_SYSTEM_PROP(BATTERY_STATE_UNKNOWN,UIDeviceBatteryStateUnknown);
MAKE_SYSTEM_PROP(BATTERY_STATE_UNPLUGGED,UIDeviceBatteryStateUnplugged);
MAKE_SYSTEM_PROP(BATTERY_STATE_CHARGING,UIDeviceBatteryStateCharging);
MAKE_SYSTEM_PROP(BATTERY_STATE_FULL,UIDeviceBatteryStateFull);

#pragma mark Delegates

-(void)batteryStateChanged:(NSNotification*)note
{
	NSDictionary *event = [NSDictionary dictionaryWithObjectsAndKeys:[self batteryState],@"state",[self batteryLevel],@"level",nil];
	[self fireEvent:@"battery" withObject:event];
}

-(void)didReceiveMemoryWarning:(NSNotification*)notification
{
	RELEASE_TO_NIL(capabilities);
	[super didReceiveMemoryWarning:notification];
}


@end

#endif