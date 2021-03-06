# Main NDK build script for @MODULE_ID@

APP_BUILD_SCRIPT := jni/Android.mk
TARGET_PLATFORM := android-21

APP_ABI := armeabi-v7a x86
ifneq ("$(CUSTOM_APP_ABI)", "")
    APP_ABI := $(CUSTOM_APP_ABI)
endif

APP_STL := c++_shared
APP_CPPFLAGS += -fno-rtti
APP_CPPFLAGS += -fexceptions

NDK_TOOLCHAIN_VERSION=4.9
APP_PLATFORM := android-21