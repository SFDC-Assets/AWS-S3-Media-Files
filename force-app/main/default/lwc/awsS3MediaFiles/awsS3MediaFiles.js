//  Javascript controller for the AWS S3 Media Files LWC.
//
//  Copyright (c) 2022, salesforce.com, inc.
//  All rights reserved.
//  SPDX-License-Identifier: BSD-3-Clause
//  For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
//
//  Contact: john.meyer@salesforce.com

import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadScript } from 'lightning/platformResourceLoader';
import { humanReadableSize, getIconName, exif2dec, isAudioFile, isVideoFile, isImageFile } from 'c/awsS3MediaUtilities';
import AWS_S3_SDK from '@salesforce/resourceUrl/AWS_S3_SDK';

const MAX_FILE_NAME_LENGTH = 1024;
const UNCONFIGURED_PREFIX = 'Change_this_prefix';
const UNCONFIGURED_ACCESS_KEY_ID = 'XXXXXXXXXXXXXXXXXXXX';
const UNCONFIGURED_SECRET_ACCESS_KEY = 'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY';
const LINK_EXPIRATION_SECS = 24 * 60 * 60;
const TRANSCRIBE_FOLDER = 'transcribed_files';
const TRANSCRIPTION_SUFFIX = '-transcribed.json';
const REDACTED_MEDIA_FILE_PREFIX = 'audio_redacted-';
const REDACTED_TRANSCRIPTION_FILE_PREFIX = 'redacted-';
const REDACTED_INDICATOR = '[PII]';
const IMAGE_FOLDER = 'image_metadata';
const IMAGE_METADATA_SUFFIX = '.json';
const IMAGE_RECOGNITION_SUFFIX = '.rekog.json';
const VIDEO_RECOGNITION_SUFFIX = '.rek.json';
const VIDEO_LABEL_FOLDER = 'video_labels';
const BLOCK_SECONDS = 10.0;

export default class AwsS3MediaFiles extends LightningElement {
	@api cardTitle = 'AWS Files';
	@api hideIcon = false;
	@api hideViewAndTranscription = false;
	@api prefix = UNCONFIGURED_PREFIX;
	@api awsRegion;
	@api awsAccessKeyId;
	@api awsSecretAccessKey;
	@api awsBucketName;
	@api recordId;

	spinnerVisible = false;

	@track s3;

	awsBucketPrefix;
	componentConfigured;

	@track fileList = [];

	get fileListEmpty() {
		return this.fileList.length === 0;
	}

	get selectAll() {
		return this.fileList.reduce((selected, file) => selected && file.selected, true);
	}

	get somethingSelected() {
		return this.fileList.reduce((selected, file) => selected || file.selected, false);
	}

	get deleteButtonDisabled() {
		return !this.somethingSelected;
	}

	@track uploadProgressList;
	progress = 0;
	uploadModalVisible = false;
	uploadInProgress = false;

	get uploadFinished() {
		return this.uploadProgressList.reduce((finished, file) => finished && file.finished, true);
	}

	get doneButtonDisabled() {
		return !this.uploadFinished;
	}

	viewModalVisible = false;
	fileBeingViewedUrl = null;
	fileBeingViewedIsVideo = false;
	fileBeingViewedIsAudio = false;
	fileBeingViewedIsImage = false;
	fileNameBeingViewed = '';
	fileBeingViewedIcon = null;
	fileHasTranscription = false;
	fileHasImageMetadata = false;
	fileHasImageRecognition = false;
	imageLatitude = null;
	imageLongitude = null;
	imageHasLatLong = false;
	mapMarkers = null;
	initialZoomLevel = 10;
	@track transcriptionData = null;
	@track imageMetadata = null;
	@track imageRecogitionWords = null;
	blockSeconds = BLOCK_SECONDS;
	transcriptionWordDocUrl = null;

	connectedCallback() {
		this.componentConfigured =
			this.prefix !== UNCONFIGURED_PREFIX &&
			this.awsAccessKeyId !== UNCONFIGURED_ACCESS_KEY_ID &&
			this.awsSecretAccessKey !== UNCONFIGURED_SECRET_ACCESS_KEY;
		this.awsBucketPrefix = (this.prefix ? this.prefix + '/' : '') + (this.recordId ? this.recordId + '/' : '');
		if (this.componentConfigured) {
			loadScript(this, AWS_S3_SDK)
				.then(() => {
					AWS.config = new AWS.Config({
						accessKeyId: this.awsAccessKeyId,
						secretAccessKey: this.awsSecretAccessKey,
						region: this.awsRegion
					});
					this.s3 = new AWS.S3({
						params: {
							Bucket: this.awsBucketName
						}
					});
					this.getFiles();
				})
				.catch((error) => {
					console.error(`awsS3Files: Could not load static resource "${AWS_S3_SDK}": ${JSON.stringify(error)}`);
				});
		}
	}

	getFiles() {
		this.spinnerVisible = true;
		this.fileList = [];
		try {
			this.s3.listObjectsV2(
				{
					Bucket: this.awsBucketName,
					Prefix: this.awsBucketPrefix
				},
				(error, data) => {
					if (error) {
						this.dispatchEvent(
							new ShowToastEvent({
								title: 'Could not get file list',
								message: error.message,
								variant: 'error',
								mode: 'sticky'
							})
						);
					} else if (data) {
						data.Contents.forEach((file) => {
							const fileName = file.Key.replace(this.awsBucketPrefix, '');
							const audioFile = isAudioFile(fileName);
							const videoFile = isVideoFile(fileName);
							const imageFile = isImageFile(fileName);
							if (
								!fileName.includes(`${TRANSCRIBE_FOLDER}/`) &&
								!fileName.includes(`${IMAGE_FOLDER}/`) &&
								!fileName.includes(`${VIDEO_LABEL_FOLDER}/`)
							) {
								this.fileList.push({
									selected: false,
									name: fileName,
									fileIsRedacted: fileName.includes(REDACTED_MEDIA_FILE_PREFIX),
									fileDisplayName: fileName.replace(REDACTED_MEDIA_FILE_PREFIX, ''),
									key: file.Key,
									fileIsViewable: audioFile || videoFile || imageFile,
									audioFile: audioFile,
									videoFile: videoFile,
									imageFile: imageFile,
									viewIcon: videoFile
										? 'utility:video'
										: audioFile
										? 'utility:volume_high'
										: imageFile
										? 'utility:image'
										: null,
									icon: getIconName(fileName),
									link: this.s3.getSignedUrl('getObject', {
										Bucket: this.awsBucketName,
										Key: file.Key,
										Expires: LINK_EXPIRATION_SECS
									}),
									lastModifiedDate: file.LastModified,
									size: humanReadableSize(file.Size)
								});
							}
						});
						this.fileList.sort((a, b) =>
							(a.fileDisplayName + (a.fileIsRedacted ? '-redacted' : '')).localeCompare(
								b.fileDisplayName + (b.fileIsRedacted ? '-redacted' : '')
							)
						);
					}
				}
			);
		} catch (error) {
			this.dispatchEvent(
				new ShowToastEvent({
					title: `JavaScript ${error.name} occurred retrieving the file list`,
					message: error.message + (error.cause ? ' caused by ' + error.cause : ''),
					variant: 'error',
					mode: 'sticky'
				})
			);
		} finally {
			this.spinnerVisible = false;
		}
	}

	handleFilesChange(event) {
		this.uploadInProgress = true;
		this.uploadModalVisible = true;
		this.uploadProgressList = [];
		[...event.target.files].forEach((file) => {
			if (file.name.length > MAX_FILE_NAME_LENGTH) {
				this.dispatchEvent(
					new ShowToastEvent({
						message: `File "${file.name}" name length (${file.name.length}) exceeds the maximum length of ${MAX_FILE_NAME_LENGTH} characters and will not be uploaded.`,
						variant: 'error',
						mode: 'sticky'
					})
				);
			} else {
				//  There is a bug in the back-end CloudFormation stack that can't handle whitespace or "+"
				//  signs in file names when doing the transcription and redaction. Replace those with "_".
				const fileNameNoWhiteSpace = file.name.replace(/\s+/g, '_').replace(/\++/g, '_');
				if (file.name !== fileNameNoWhiteSpace)
					this.dispatchEvent(
						new ShowToastEvent({
							title: `File name "${file.name}" contains whitespace or "+" characters`,
							message: `The file will be uploaded as "${fileNameNoWhiteSpace}".`,
							variant: 'info',
							mode: 'sticky'
						})
					);
				this.uploadProgressList.push({
					name: file.name,
					key: `${this.awsBucketPrefix}${fileNameNoWhiteSpace}`,
					fileType: file.type,
					iconName: getIconName(file.name),
					statusIcon: 'utility:threedots',
					statusIconVariant: null,
					progress: 0,
					loaded: '',
					total: '',
					finished: false
				});
				let uploadRequest = new AWS.S3.ManagedUpload({
					params: {
						Bucket: this.awsBucketName,
						Key: `${this.awsBucketPrefix}${fileNameNoWhiteSpace}`,
						Body: file
					}
				});
				uploadRequest.on('httpUploadProgress', (progress) => {
					let item = this.uploadProgressList.find((elem) => elem.key === progress.key);
					item.progress = Math.round((progress.loaded * 100) / progress.total);
					item.loaded = humanReadableSize(progress.loaded);
					item.total = humanReadableSize(progress.total);
				});
				uploadRequest
					.promise()
					.then((result) => {
						let item = this.uploadProgressList.find((elem) => elem.key === result.Key);
						item.finished = true;
						item.statusIcon = 'utility:success';
						item.statusIconVariant = 'success';
					})
					.catch((error) => {
						let item = this.uploadProgressList.find((elem) => elem.name === file.name);
						item.finished = true;
						item.statusIcon = 'utility:error';
						item.statusIconVariant = 'error';
						this.dispatchEvent(
							new ShowToastEvent({
								title: `Error uploading file "${file.name}"`,
								message: error.message,
								variant: 'error',
								mode: 'sticky'
							})
						);
					});
			}
		});
	}

	handleModalDoneButton(event) {
		this.uploadModalVisible = false;
		this.getFiles();
	}

	handleModalCloseButton(event) {
		this.dispatchEvent(
			new ShowToastEvent({
				message: 'Remaining uploads cancelled.',
				variant: 'info'
			})
		);
		this.handleModalDoneButton(event);
	}

	handleDeleteButton(event) {
		let deleteList = [];
		this.fileList.forEach((file) => {
			if (file.selected) {
				//  Delete the file and all of its transcription metadata, transcription, redaction, and/or EXIF metadata.
				deleteList.push({ Key: file.key });
				if (file.audioFile || file.videoFile) {
					deleteList.push({
						Key: `${this.awsBucketPrefix}${TRANSCRIBE_FOLDER}/${file.name}${TRANSCRIPTION_SUFFIX}`.replace(
							REDACTED_MEDIA_FILE_PREFIX,
							REDACTED_TRANSCRIPTION_FILE_PREFIX
						)
					});
					deleteList.push({
						Key: `${this.awsBucketPrefix}${TRANSCRIBE_FOLDER}/${file.name}.docx`.replace(
							REDACTED_MEDIA_FILE_PREFIX,
							REDACTED_TRANSCRIPTION_FILE_PREFIX
						)
					});
					if (file.videoFile) {
						deleteList.push({
							Key: `${this.awsBucketPrefix}${IMAGE_FOLDER}/${file.name}${IMAGE_METADATA_SUFFIX}`
						});
						deleteList.push({
							Key: `${this.awsBucketPrefix}${VIDEO_LABEL_FOLDER}/${file.name}${VIDEO_RECOGNITION_SUFFIX}`
						});
					}
				} else if (file.imageFile) {
					deleteList.push({
						Key: `${this.awsBucketPrefix}${IMAGE_FOLDER}/${file.name}${IMAGE_METADATA_SUFFIX}`
					});
					deleteList.push({
						Key: `${this.awsBucketPrefix}${IMAGE_FOLDER}/${file.name}${IMAGE_RECOGNITION_SUFFIX}`
					});
				}
			}
		});
		this.s3.deleteObjects(
			{
				Bucket: this.awsBucketName,
				Delete: {
					Objects: deleteList
				}
			},
			(error, data) => {
				if (error) {
					this.dispatchEvent(
						new ShowToastEvent({
							title: `Could not delete files`,
							message: error.message,
							variant: 'error',
							mode: 'sticky'
						})
					);
					this.getFiles();
				} else if (data) {
					this.dispatchEvent(
						new ShowToastEvent({
							message: `Files deleted.`,
							variant: 'success'
						})
					);
					this.getFiles();
				}
			}
		);
	}

	handleFileSelected(event) {
		this.fileList.find((file) => file.key === event.target.getAttribute('data-key')).selected = event.target.checked;
	}

	handleSelectAll(event) {
		this.fileList.forEach((file) => {
			file.selected = event.target.checked;
		});
	}

	handleViewFile(event) {
		const file = this.fileList.find((file) => file.key === event.target.getAttribute('data-key'));
		if (isAudioFile(file.name) || isVideoFile(file.name)) this.doMedia(file);
		else if (isImageFile(file.name)) this.doImage(file);
	}

	doMedia(file) {
		let transcriptionFileName, transcriptionWordDocument;
		if (file.name.startsWith(REDACTED_MEDIA_FILE_PREFIX)) {
			transcriptionFileName = `${file.name.replace(
				REDACTED_MEDIA_FILE_PREFIX,
				REDACTED_TRANSCRIPTION_FILE_PREFIX
			)}${TRANSCRIPTION_SUFFIX}`;
			transcriptionWordDocument = `${file.name.replace(REDACTED_MEDIA_FILE_PREFIX, REDACTED_TRANSCRIPTION_FILE_PREFIX)}.docx`;
		} else {
			transcriptionFileName = `${file.name}${TRANSCRIPTION_SUFFIX}`;
			transcriptionWordDocument = `${file.name}.docx`;
		}
		this.fileBeingViewedUrl = file.link;
		this.fileNameBeingViewed = file.name;
		this.fileBeingViewedIsVideo = file.videoFile;
		this.fileBeingViewedIsAudio = file.audioFile;
		this.fileBeingViewedIcon = file.viewIcon;
		this.transcriptionWordDocUrl = this.s3.getSignedUrl('getObject', {
			Bucket: this.awsBucketName,
			Key: `${this.awsBucketPrefix}${TRANSCRIBE_FOLDER}/${transcriptionWordDocument}`,
			Expires: LINK_EXPIRATION_SECS
		});
		this.s3.getObject(
			{
				Bucket: this.awsBucketName,
				Key: `${this.awsBucketPrefix}${TRANSCRIBE_FOLDER}/${transcriptionFileName}`
			},
			(error, data) => {
				if (error) this.fileHasTranscription = false;
				else {
					this.transcriptionData = [];
					let blockOfItems = [];
					let lastStartTime = 0.0;
					//  cycle through each word in the transcription
					JSON.parse(data.Body.toString('utf-8')).results.items.forEach((item) => {
						const isText = item.type === 'pronunciation';
						const word = item.alternatives[0].content;
						const isRedacted = word === REDACTED_INDICATOR;
						const startTime = 'start_time' in item ? parseFloat(item.start_time) : null;
						if (startTime && startTime > lastStartTime + BLOCK_SECONDS) {
							const blockStartTimeString =
								lastStartTime < 3600.0
									? new Date(Math.round(lastStartTime * 1000.0)).toISOString().substring(14, 19)
									: new Date(Math.round(lastStartTime * 1000.0)).toISOString().substring(11, 16);
							this.transcriptionData.push({
								id: blockStartTimeString,
								blockStartTime: lastStartTime,
								blockEndTime: 'end_time' in item ? parseFloat(item.end_time) : null,
								blockStartTimeString: blockStartTimeString,
								textBlock: blockOfItems
							});
							blockOfItems = [];
							lastStartTime = startTime;
						}
						blockOfItems.push({
							startTime: startTime,
							isRedacted: isRedacted,
							text: isRedacted ? 'REDACTED' : word,
							confidence: !isText
								? `"${word}"`
								: isRedacted
								? 'Redacted'
								: `"${word}" Confidence: ${Math.round(item.alternatives[0].confidence * 100)}%`,
							isText: isText
						});
					});
					this.fileHasTranscription = true;
				}
			}
		);
		this.viewModalVisible = true;
	}

	doImage(file) {
		this.fileBeingViewedUrl = file.link;
		this.fileNameBeingViewed = file.name;
		this.fileBeingViewedIcon = file.viewIcon;
		this.fileBeingViewedIsImage = true;
		this.s3.getObject(
			{
				Bucket: this.awsBucketName,
				Key: `${this.awsBucketPrefix}${IMAGE_FOLDER}/${file.name}${IMAGE_METADATA_SUFFIX}`
			},
			(error, data) => {
				if (error) this.fileHasImageMetadata = false;
				else {
					this.imageMetadata = [];
					let metadata = JSON.parse(data.Body.toString('utf-8'));
					for (const metadataKey in metadata[0]) {
						this.imageMetadata.push({
							metadataKey: metadataKey,
							metadataValue: metadata[0][metadataKey].toString()
						});
					}
					this.imageLatitude = 'GPSLatitude' in metadata[0] ? exif2dec(metadata[0].GPSLatitude) : null;
					this.imageLongitude = 'GPSLongitude' in metadata[0] ? exif2dec(metadata[0].GPSLongitude) : null;
					this.imageHasLatLong = this.imageLatitude !== null && this.imageLongitude !== null;
					if (this.imageHasLatLong) {
						this.mapMarkers = [
							{
								location: {
									Latitude: this.imageLatitude,
									Longitude: this.imageLongitude
								}
							}
						];
					}
					this.fileHasImageMetadata = true;
				}
			}
		);
		this.s3.getObject(
			{
				Bucket: this.awsBucketName,
				Key: `${this.awsBucketPrefix}${IMAGE_FOLDER}/${file.name}${IMAGE_RECOGNITION_SUFFIX}`
			},
			(error, data) => {
				if (error) this.fileHasImageRecognition = false;
				else {
					this.imageRecogitionWords = [];
					JSON.parse(data.Body.toString('utf-8')).Labels.forEach((word) => {
						this.imageRecogitionWords.push({
							word: word.Name,
							confidence: `${Math.round(word.Confidence)}%`
						});
					});
					this.fileHasImageRecognition = true;
				}
			}
		);
		this.viewModalVisible = true;
	}

	handleWordClick(event) {
		const startTime = event.target.getAttribute('data-start-time');
		if (this.fileBeingViewedIsVideo) {
			const videoElement = this.template.querySelector('video');
			videoElement.play();
			videoElement.pause();
			videoElement.currentTime = startTime;
			videoElement.play();
		} else if (this.fileBeingViewedIsAudio) {
			const audioElement = this.template.querySelector('audio');
			audioElement.play();
			audioElement.pause();
			audioElement.currentTime = startTime;
			audioElement.play();
		}
	}

	handleViewModalDoneButton(event) {
		this.fileBeingViewedUrl = null;
		this.fileNameBeingViewed = '';
		this.fileBeingViewedIsVideo = false;
		this.fileBeingViewedIsAudio = false;
		this.fileBeingViewedIsImage = false;
		this.imageLatitude = null;
		this.imageLongitude = null;
		this.imageHasLatLong = null;
		this.fileHasImageMetadata = false;
		this.fileHasImageRecognition = false;
		this.imageRecogitionWords = null;
		this.fileBeingViewedIcon = null;
		this.viewModalVisible = false;
		this.transcriptionData = [];
		this.transcriptionWordDocUrl = null;
	}
}