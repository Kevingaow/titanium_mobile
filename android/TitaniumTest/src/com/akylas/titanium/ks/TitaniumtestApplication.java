/* AUTO-GENERATED FILE.  DO NOT MODIFY.
 *
 * This class was automatically generated by 
 * Appcelerator. It should not be modified by hand.
 */
package com.akylas.titanium.ks;

import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

import org.appcelerator.kroll.common.TiConfig;
import org.appcelerator.kroll.runtime.v8.V8Runtime;
import org.appcelerator.kroll.KrollExternalModule;
import org.appcelerator.kroll.KrollModule;
import org.appcelerator.kroll.KrollModuleInfo;
import org.appcelerator.kroll.KrollRuntime;
import org.appcelerator.titanium.TiApplication;
import org.appcelerator.titanium.TiProperties;
import org.appcelerator.titanium.TiRootActivity;

public final class TitaniumtestApplication extends TiApplication {
    private static final String TAG = "TitaniumtestApplication";

    @SuppressWarnings("static-access")
    @Override
    public void onCreate() {
        super.onCreate();
        TiConfig.DEBUG = TiConfig.LOGD = true;
        appInfo = new TitaniumtestAppInfo(this);

        HashMap<String, Class[]> modules = new HashMap<String, Class[]>() {
            {
                put("akylas.shapes", new Class[] {
                        akylas.shapes.AkylasShapesBootstrap.class,
                        akylas.shapes.AkylasShapesModule.class });
                put("akylas.commonjs", new Class[] {
                        akylas.commonjs.AkylasCommonjsBootstrap.class,
                        akylas.commonjs.AkylasCommonjsModule.class });
                put("akylas.slidemenu", new Class[] {
                        akylas.slidemenu.AkylasSlidemenuBootstrap.class,
                        akylas.slidemenu.AkylasSlidemenuModule.class });
                // put("akylas.mapbox", new
                // Class[]{akylas.mapbox.AkylasMapboxBootstrap.class,
                // akylas.mapbox.AkylasMapboxModule.class});
                // put("akylas.googlemap", new
                // Class[]{akylas.googlemap.AkylasGooglemapBootstrap.class,
                // akylas.googlemap.AkylasGooglemapModule.class});
                // put("akylas.charts", new
                // Class[]{akylas.charts.AkylasChartsBootstrap.class,
                // akylas.charts.AkylasChartsModule.class});
                // put("akylas.location", new
                // Class[]{akylas.location.AkylasLocationBootstrap.class,
                // akylas.location.AkylasLocationModule.class});
                // put("akylas.admob", new
                // Class[]{akylas.admob.AkylasAdmobBootstrap.class,
                // akylas.admob.AkylasAdmobModule.class});
                // put("akylas.triton", new
                // Class[]{akylas.triton.AkylasTritonBootstrap.class,
                // akylas.admob.AkylasAdmobModule.class});
                // put("facebook", new Class[]{facebook.FacebookBootstrap.class,
                // facebook.FacebookModule.class});
                // put("akylas.millenoki.vpn", new
                // Class[]{akylas.millenoki.vpn.MillenokiVpnBootstrap.class,
                // akylas.millenoki.vpn.MillenokiVpnModule.class});
                // put("akylas.millenoki.location", new
                // Class[]{akylas.millenoki.location.MillenokiLocationModuleBootstrap.class,
                // akylas.millenoki.location.MillenokiLocationModule.class});
            }
        };
        V8Runtime runtime = new V8Runtime();

        Iterator it = modules.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry pairs = (Map.Entry) it.next();
            runtime.addExternalModule((String) pairs.getKey(),
                    (Class<? extends KrollExternalModule>) (((Class[]) (pairs
                            .getValue()))[0]));
        }
        runtime.addExternalCommonJsModule("akylas.commonjs",
                akylas.commonjs.CommonJsSourceProvider.class);
        // Custom modules
        KrollModuleInfo moduleInfo;

        try {
            it = modules.entrySet().iterator();
            while (it.hasNext()) {
                Map.Entry pairs = (Map.Entry) it.next();

                Method method = ((((Class[]) (pairs.getValue()))[1]))
                        .getMethod("onAppCreate", TiApplication.class);
                method.invoke(null, this);
                moduleInfo = new KrollModuleInfo((String) pairs.getKey(),
                        (String) pairs.getKey(), "", "", "", "", "", "");
                KrollModule.addCustomModuleInfo(moduleInfo);
            }
        } catch (Exception e) {
        }

        postAppInfo();
        KrollRuntime.init(this, runtime);
        postOnCreate();

    }
//    @Override
//    public void postOnCreate() {
//    {
//        TiProperties properties = getSystemProperties();
//        TiProperties appProperties = getAppProperties();
//                    
//        properties.setString("ti.ui.defaultunit", "dp");
//        appProperties.setString("ti.ui.defaultunit", "dp");
//        properties.setBool("ti.android.bug2373.finishfalseroot", true);
//        appProperties.setBool("ti.android.bug2373.finishfalseroot", true);
//        properties.setBool("ti.android.fastdev", false);
//        appProperties.setBool("ti.android.fastdev", false);
//    }

    @Override
    public void verifyCustomModules(TiRootActivity rootActivity) {
    }
}
