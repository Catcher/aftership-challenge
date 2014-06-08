/*
 *	@requires cheerio
 *	@requires request
 *  @requires moment
 */
var ERROR_SERVER = 'Sorry, there is some problem on server, we will get it fixed as soon as possible, please try again later.';
var ERROR_ON_COURIER_SERVER = 'We faced some problem getting track records from {0}, please try again later.';
var ERROR_RECORD_NOT_FOUND = 'The track records cannot be found, please make sure you have enter correct Track ID.';

(function() {
	function Courier() {
		/* 
		 * Get item info from Usps official api
		 * 1. Query Usps official api using Xml with TrackFieldRequest tag
		 * 2. expected info in 'TrackSummary' tag of response
		 * @param {tracking_number} item number you want to track
		 * @param {function()} callback - Function that will be called no matter tracking is success or fail
		 *        arg1 - error object
		 *        arg2 - tracking info (null if fail)
		 *
		 * Remark: For the Xml used in http request
		 * The TrackRequest tag suggested on the website is misleading (https://www.usps.com/business/web-tools-apis/delivery-information.htm)
		 * Use TrackFieldRequest tag suggested in the pdf (https://www.usps.com/business/web-tools-apis/track-and-confirm.pdf)
		 *
		 * QUESTION Should also return checkpoints other than the one "Delivered"? But it is not included in test cast.
		 */
		this.usps = function(tracking_number, callback) {
			console.log('Start usps');

			var self = this;

			// Url of Usps Api
			// TODO It is a testing environment, change it to production environment if ready to launch
			var strUspsApiUrl = 'http://testing.shippingapis.com/ShippingAPITest.dll';

			var request = require('request');

			// Construct string for Xml request in Usps Api
			var strXmlApiRequest = '<TrackFieldRequest USERID=\"754REDBI4747\"><TrackID ID=\"' + tracking_number + '\"></TrackID></TrackFieldRequest>';

			// Used to construct query string
			var queryStringObj = {
				API: 'TrackV2',
				XML: strXmlApiRequest
			};

			// Option of http request
			var requestOptions = {
				uri: strUspsApiUrl,
				qs: queryStringObj,
				method: 'GET',
				proxy: 'http://192.168.1.121:8888'
			};

			var request = require('request');

			// Get information from Usps Api
			request(requestOptions, function(error, response, body) {
				console.log('Http Request: ' + strUspsApiUrl);
				var cheerio = null;

				// Error checking
				try {
					// Http error checking
					self._checkHttpErr(error, response);

					// Usps error checking
					cheerio = require('cheerio'); // a DOM parser
					$ = cheerio.load(body, {
						xmlMode: true
					});
					self._checkUspsError($);
				} catch (err) {
					callback(err, null);
					return;
				}

				var tracking_result = self._getResultFromUspsBody($);
				callback(null, tracking_result);
			});
		};



		/*
		 * Get item info from Hong Kong Post, by web scraping from the web page
		 * 1. Getting track info from http://app3.hongkongpost.hk/CGI/mt/e_detail.jsp
		 * 2. Extract the info by web scraping 
		 * @param {tracking_number} item number you want to track
		 * @param {function()} callback - Function that will be called no matter tracking is success or fail
		 *        arg1 - error object, if any
		 *        arg2 - tracking info (null if fail)
		 */
		this.hkpost = function(tracking_number, callback) {
			console.log('Start hkpost');

			var self = this;

			var request = require('request');

			// Url of retrieving mail status in Hong Kong Post
			var strhkpostUrl = 'http://app3.hongkongpost.hk/CGI/mt/e_detail.jsp';

			// Used to construct query string
			var queryStringObj = {
				mail_type: 'parcel_ouw',
				tracknbr: tracking_number,
				localno: tracking_number
			};

			// Option of http request
			var requestOptions = {
				uri: strhkpostUrl,
				qs: queryStringObj,
				method: 'GET',
				// if record not found on Hong Kong Post web site, it will redirect to enquiry page
				// I set followRedirect to false, when a redirection occurred, the status code is 302, it is considered as error
				followRedirect: false
			};

			// Get information from Hong Kong Post Website
			request(requestOptions, function(error, response, body) {
				console.log('Http Request: ' + strhkpostUrl);

				// Error checking
				try {
					// Http error checking
					self._checkHttpErr(error, response);
				} catch (err) {
					callback(err, null);
					return;
				}

				var tracking_result = self._getResultFromHkpostBody(body);
				callback(null, tracking_result);
			});
		};


		/*
		 * Get item info from dpduk
		 * 1. get Parcel Code and SESSIONID from http://www.dpd.co.uk/esgServer/shipping/shipment/_/parcel/
		 * 2. using the Parcel Code get track info from http://www.dpd.co.uk/esgServer/shipping/delivery/
		 * 3. remember add SESSIONID in cookie when getting track info
		 * @param {tracking_number} item number you want to track
		 * @param {function()} callback - Function that will be called no matter tracking is success or fail
		 *        arg1 - error object
		 *        arg2 - tracking info (null if fail)
		 */
		this.dpduk = function(tracking_number, callback) {
			console.log('Start dpduk');

			var self = this;

			// Get Parcel Code and Session ID
			self._getParcelCodeSessionIdFromDpduk(tracking_number, function(error, parcelCode, sessionId) {
				// Success getting Parcel Code and Session ID
				if (error == null) {
					var request = require('request');

					var dpdukGetParcelTrackUrl = 'http://www.dpd.co.uk/esgServer/shipping/delivery/';

					// Construct query string
					var queryStringObj = {
						parcelCode: parcelCode
					};

					// Option of http request
					var requestOptions = {
						uri: dpdukGetParcelTrackUrl,
						followRedirect: false,
						method: 'GET',
						headers: {
							cookie: 'tracking=' + sessionId
						},
						qs: queryStringObj
					}

					// Get tracking information from dpduk
					request(requestOptions, function(error, response, body) {
						console.log('Http Request: ' + dpdukGetParcelTrackUrl);
						var bodyJsonObj = null;
						// Error checking
						try {
							// Http error checking
							self._checkHttpErr(error, response);
							// Dpduk specific checking
							bodyJsonObj = JSON.parse(body);
							self._checkDpdukError(bodyJsonObj);

						} catch (err) {
							callback(err, null);
							return;
						}

						// Get result from the body
						var tracking_result = self._getResultFromDpdukBody(bodyJsonObj);
						callback(null, tracking_result);

					});
				} else { // Error in getting Parcel Code and Session ID
					callback(error, null);
				}
			});
		};

		// This function is used to get Parcel Code and Session ID for later query
		this._getParcelCodeSessionIdFromDpduk = function(tracking_number, callback) {
			console.log('Start _getParcelCodeSessionIdFromDpduk');

			var self = this;

			var request = require('request');

			var dpdukGetParcelCodeUrl = 'http://www.dpd.co.uk/esgServer/shipping/shipment/_/parcel/';

			// Construct query string
			var queryStringObj = {
				filter: 'id',
				searchCriteria: 'deliveryReference=' + tracking_number
			};

			// Option of http request
			var requestOptions = {
				uri: dpdukGetParcelCodeUrl,
				followRedirect: false,
				method: 'GET',
				qs: queryStringObj
			}

			// Get parcel code (later use for tracking) from dpduk
			request(requestOptions, function(error, response, body) {
				console.log('Http Request: ' + dpdukGetParcelCodeUrl);
				var bodyJsonObj = null;
				// Error checking
				try {
					// Http error checking
					self._checkHttpErr(error, response);

					// Specific Error Checking for getting Parcel Code 
					bodyJsonObj = JSON.parse(body);
					self._checkDpdukGetParcelCodeSessionIDErr(bodyJsonObj);
				} catch (err) {
					callback(err, null);
					return;
				}

				// For further query use
				var strParcelCode = bodyJsonObj.obj.parcel[0].parcelCode;

				// Put it in cookie to avoid access denied
				var strSessionId = bodyJsonObj.obj.searchSession;

				callback(null, strParcelCode, strSessionId);
			});
		}

		// Extract information from the response of Usps api
		this._getResultFromUspsBody = function($) {
			console.log('Start _getResultFromUspsBody');

			var result = {};
			var arrCheckpoints = [];

			var moment = require('moment'); // for Date formating 

			// Get info from the "TrackSummary" node from the Api response
			var strEventDate = $('TrackSummary EventDate').html();
			var strEventTime = $('TrackSummary EventTime').html();
			var strEvent = $('TrackSummary Event').html();
			var strEventCountry = $('TrackSummary EventCountry').html();

			// Prepare the result			
			var checkpointsObject = {
				country_name: strEventCountry,
				message: strEvent,
				checkpoint_time: moment(new Date(strEventDate + ' ' + strEventTime)).format('YYYY-MM-DDTHH:mm:ss')
			};
			arrCheckpoints.push(checkpointsObject);
			result.checkpoints = arrCheckpoints;
			return result;
		};

		// Extract information from the response of Usps api
		this._getResultFromHkpostBody = function(hkpostBody) {
			console.log('Start _getResultFromHkpostBody');
			var result = {};
			var arrCheckpoints = [];

			var moment = require('moment'); // for Date formating 
			var cheerio = require('cheerio'); // a DOM parser
			$ = cheerio.load(hkpostBody);

			$('table.detail').last().find('tr').each(function(index) {
				if (index != 0) {
					var strCountry = $('td', this).eq(1).html();
					var strDate = $('td', this).eq(0).html();
					var strStatus = $('td', this).eq(2).html();
					var strCountry = strCountry.split(' ')[0].charAt(0) + strCountry.split(' ')[1].charAt(0)
					var checkpointsObject = {
						country_name: strCountry,
						message: strStatus,
						checkpoint_time: moment(new Date(strDate)).format('YYYY-MM-DDTHH:mm:ss')
					};
					arrCheckpoints.push(checkpointsObject);
				}
			});
			result.checkpoints = arrCheckpoints;
			return result;
		}

		// Extract information from the response of Dpduk body
		this._getResultFromDpdukBody = function(dpdukBody) {
			console.log('Start _getResultFromDpdukBody');

			var tracking_result = {};
			var checkpoints = [];
			var moment = require('moment'); // for Date formating 

			var arrTrackingEvents = dpdukBody.obj.trackingEvent;

			// Sort the tracking Event in asc order
			arrTrackingEvents.sort(function(a, b) {
				return new Date(a.trackingEventDate) - new Date(b.trackingEventDate);
			});

			// Prepare the tracking result
			arrTrackingEvents.forEach(function(element, index, array) {
				checkpoints.push({
					country_name: element.trackingEventLocation,
					message: element.trackingEventStatus,
					checkpoint_time: moment(element.trackingEventDate, 'YYYY-MM-DDTHH:mm:ss.SSS').format('YYYY-MM-DDTHH:mm:ss')
				});
			});

			tracking_result.checkpoints = checkpoints;

			return tracking_result;
		}

		// Check Http request error, throw error is error exists
		this._checkHttpErr = function(error, response) {
			var err = null;
			if (error || response.statusCode != 200) {
				throw ERROR_SERVER; // 
			}
			return;
		}

		// Check Usps specific error, throw error is error exists
		this._checkUspsError = function($) {
			// Error tag found in xml 
			if ($('Error').length > 0) {
				// Record not found
				if ($('Error > Description').html() === 'No record of that item') {
					throw ERROR_RECORD_NOT_FOUND;
				} else { // Other error
					throw ERROR_ON_COURIER_SERVER.replace('{0}', 'USPS');
				}
			}
			return;
		}

		// Check Dpduk specific error, throw error is error exists
		this._checkDpdukError = function(bodyJsonObj) {
			if (!bodyJsonObj.success) { // DPD (UK) Api return not success
				throw ERROR_ON_COURIER_SERVER.replace('{0}', 'DPD (UK)');
			}
			return;
		}

		// Check Dpduk specific error in getting Parcel Code, throw error is error exists
		this._checkDpdukGetParcelCodeSessionIDErr = function(bodyJsonObj) {
			if (bodyJsonObj.success) {
				// Check is any record found
				if (bodyJsonObj.obj.totalResults == 0) { // Record not found
					throw ERROR_RECORD_NOT_FOUND;
				}
			} else { // Not success in getting Parcel Code and Session ID 
				throw ERROR_ON_COURIER_SERVER.replace('{0}', 'DPD (UK)');
			}
			return;
		}
	}
	module.exports = new Courier();
}());