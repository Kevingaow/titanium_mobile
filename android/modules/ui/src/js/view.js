/**
 * Appcelerator Titanium Mobile
 * Copyright (c) 2015 by Appcelerator, Inc. All Rights Reserved.
 * Licensed under the terms of the Apache Public License
 * Please see the LICENSE included with this distribution for details.
 */

var TAG = "View";

exports.bootstrap = function(Titanium) {

	var View = Titanium.UI.View;
	var TiWindow = Titanium.TiWindow;

	var _add = View.prototype.add;
	View.prototype.add = function(child, index) {
		this._children = this._children || [];
		_add.call(this, child, index);
		// The children have to be retained by the view in the Javascript side
		// in order to let V8 know the relationship between children and the view.
		// Therefore, as long as its window is open, all its children won't be detached
		// or garbage collected and V8 will recoganize the closures and retain all
		// the related proxies.
		this._children.push(child);
	}

	var _remove = View.prototype.remove;
	View.prototype.remove = function(child) {
		_remove.call(this, child);

		// Remove the child in the Javascript side so it can be detached and garbage collected.
		var children = this._children || [];
		var childIndex = children.indexOf(child);
		if (childIndex != -1) {
			children.splice(childIndex, 1);
		}
	}
};
