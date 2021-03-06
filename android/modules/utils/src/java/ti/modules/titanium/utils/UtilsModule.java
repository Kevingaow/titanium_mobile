/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2009-2016 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */
package ti.modules.titanium.utils;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;

import org.apache.commons.codec.digest.DigestUtils;
import org.appcelerator.kroll.KrollModule;
import org.appcelerator.kroll.annotations.Kroll;
import org.appcelerator.kroll.common.Log;
import org.appcelerator.titanium.TiBlob;
import org.appcelerator.titanium.TiFileProxy;
import org.appcelerator.titanium.util.TiConvert;
import org.appcelerator.titanium.util.TiMimeTypeHelper;
import org.appcelerator.titanium.util.TiUIHelper;

import android.util.Base64;

@Kroll.module
public class UtilsModule extends KrollModule
{
	private static final String TAG = "UtilsModule";

	public UtilsModule()
	{
		super();
	}

	private String convertToString(Object obj)
	{
		if (obj instanceof String) {
			return (String) obj;
		} else if (obj instanceof TiBlob) {
			return ((TiBlob) obj).getText();
		} else {
			throw new IllegalArgumentException("Invalid type for argument");
		}
	}

	@Kroll.method
	public TiBlob base64encode(Object obj)
	{
		if (obj instanceof TiBlob) {
			return TiBlob.blobFromObject(((TiBlob) obj).toBase64());
		} else if (obj instanceof TiFileProxy) {
			try {
				return TiBlob.blobFromObject(((TiFileProxy) obj).getInputStream(),
					TiMimeTypeHelper.getMimeType(((TiFileProxy) obj).getBaseFile().nativePath()));
			} catch (IOException e) {
				Log.e(TAG, "Problem reading file");
			}
		}
		String data = convertToString(obj);
		if (data != null) {
			try {
				return TiBlob.blobFromObject(Base64.encodeToString(data.getBytes("UTF-8"), Base64.NO_WRAP));
			} catch (UnsupportedEncodingException e) {
				Log.e(TAG, "UTF-8 is not a supported encoding type");
			}
		}
		return null;
	}

	@Kroll.method
	public TiBlob base64decode(Object obj)
	{
		String data = convertToString(obj);
		if (data != null) {
//			try {
				return TiBlob.blobFromObject(Base64.decode(data, Base64.NO_WRAP));
//			} catch (UnsupportedEncodingException e) {
//				Log.e(TAG, "UTF-8 is not a supported encoding type");
//			}
		}
		return null;
	}

	@Kroll.method
	public String md5HexDigest(Object obj)
	{
		if (obj instanceof TiBlob) {
			return DigestUtils.md5Hex(((TiBlob) obj).getBytes());
		}
		String data = convertToString(obj);
		if (data != null) {
			return DigestUtils.md5Hex(data);
		}
		return null;
	}

	@Kroll.method
	public String sha1(Object obj)
	{
		if (obj instanceof TiBlob) {
			return DigestUtils.shaHex(((TiBlob) obj).getBytes());
		}
		String data = convertToString(obj);
		if (data != null) {
			return DigestUtils.shaHex(data);
		}
		return null;
	}

	@Kroll.method
	public boolean arrayTest(float[] a, long[] b, int[] c, String[] d)
	{
		return true;
	}

	@Kroll.method
	public String sha256(Object obj)
	{
		// NOTE: DigestUtils with the version before 1.4 doesn't have the function sha256Hex,
		// so we deal with it ourselves
		try {
			byte[] b = null;
			if (obj instanceof TiBlob) {
				b = ((TiBlob) obj).getBytes();
			} else {
				String data = convertToString(obj);
				b = data.getBytes();
			}
			MessageDigest algorithm = MessageDigest.getInstance("SHA-256");
			algorithm.reset();
			algorithm.update(b);
			byte messageDigest[] = algorithm.digest();
			StringBuilder result = new StringBuilder();
			for (int i = 0; i < messageDigest.length; i++) {
				result.append(Integer.toString((messageDigest[i] & 0xff) + 0x100, 16).substring(1));
			}
			return result.toString();
		} catch (NoSuchAlgorithmException e) {
			Log.e(TAG, "SHA256 is not a supported algorithm");
		}
		return null;
	}

	public String transcodeString(String orig, String inEncoding, String outEncoding)
	{
		try {

			Charset charsetOut = Charset.forName(outEncoding);
			Charset charsetIn = Charset.forName(inEncoding);

			ByteBuffer bufferIn = ByteBuffer.wrap(orig.getBytes(charsetIn.name()) );
			CharBuffer dataIn = charsetIn.decode(bufferIn);
			bufferIn.clear();
			bufferIn = null;

			ByteBuffer bufferOut = charsetOut.encode(dataIn);
			dataIn.clear();
			dataIn = null;
			byte[] dataOut = bufferOut.array();
			bufferOut.clear();
			bufferOut = null;

			return new String(dataOut, charsetOut.name());

		} catch (UnsupportedEncodingException e) {
			Log.e(TAG, "Unsupported encoding: " + e.getMessage(), e);
		}
		return null;
	}

	@Override
	public String getApiName()
	{
		return "Ti.Utils";
	}

}
