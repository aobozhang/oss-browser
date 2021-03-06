'use strict';

var Base = require('./base');
var fs = require('fs');
var path = require('path');
var util = require('./download-job-util');

class DownloadJob extends Base {

  /**
   *
   * @param ossClient
   * @param config
   *    config.from {object|string}  {bucket, key} or oss://bucket/test/a.jpg
   *    config.to   {object|string}  {name, path} or /home/admin/a.jpg
   *    config.checkPoint
   *
   *    config.chunkSize
   */
  constructor(ossClient, config) {
    super();


    this.oss = ossClient;
    this._config = {};
    Object.assign(this._config, config);

    if (!this._config.from) {
      console.log('需要 from');
      return;
    }
    if (!this._config.to) {
      console.log('需要 to');
      return;
    }

    this.from = util.parseOssPath(this._config.from);  //oss path
    this.to = util.parseLocalPath(this._config.to);  //local path
    this.region = this._config.region;

    this.prog = this._config.prog ||  {
        loaded: 0,
        total: 0
      };

    this.status = this._config.status || 'waiting';

    this.stopFlag = this.status!='running';

    this.checkPoints = this._config.checkPoints;

    //console.log('created download job');
  }
}



DownloadJob.prototype.start = function () {
  var self = this;

  self.startTime = new Date().getTime();
  self.endTime = null;

  self.stopFlag = false;
  self._changeStatus('running');

  self.checkPoints = self.checkPoints||{
    from: self.from,
    to: self.to,
    Parts: {}
  };
  self.startDownload(self.checkPoints);

  self.startSpeedCounter();

  return self;
};

DownloadJob.prototype.stop = function () {
  var self = this;
  self.stopFlag = true;
  self._changeStatus('stopped');
  this.speed = 0;
  this.predictLeftTime = 0;
  return self;
};

DownloadJob.prototype.wait = function () {
  var self = this;
  self.stopFlag = true;
  self._changeStatus('waiting');
  return self;
};

DownloadJob.prototype._changeStatus = function(status){
  var self= this;
  self.status=status;
  self.emit('statuschange',self.status);

  if(status=='failed' || status=='stopped' || status=='finished'){
    self.endTime = new Date().getTime();
   // util.closeFD(this.keepFd);
  }
};


DownloadJob.prototype.startSpeedCounter = function(){
  var self = this;

  self.lastLoaded = 0;

  self.speedTid = setInterval(function(){

    if(self.stopFlag){
      self.speed = 0;
      self.predictLeftTime= 0;
      return;
    }

    self.speed = self.prog.loaded - self.lastLoaded;
    self.lastLoaded=self.prog.loaded;

    //推测耗时
    self.predictLeftTime =  self.speed == 0 ? 0 : Math.floor((self.prog.total-self.prog.loaded)/self.speed*1000);

  },1000);


  function onFinished(){
    clearInterval(self.speedTid);
    self.speed = 0;
    //推测耗时
    self.predictLeftTime=0;
  }

  self.on('stopped',onFinished);
  self.on('error', onFinished);
  self.on('complete',onFinished);
};



/**
 * 开始上传
 */
DownloadJob.prototype.startDownload = function startDownload(checkPoints){
  var self = this;

  var chunkNum = 0;
  var chunkSize = 0;
  //var keepFd;
  var chunks = [];

  var completedCount = 0;
  var completedBytes= 0;


  var maxRetries = 5;
  var maxConcurrency = 3;
  var concurrency = 0;

  //console.log('maxConcurrency:', maxConcurrency);

  var tmpName = self.to.path + '.download';

  var objOpt = {
    Bucket: self.from.bucket,
    Key: self.from.key
  };


  self.oss.headObject(objOpt, function (err, headers) {

    if(err){
      console.error('failed to get oss object meta: ', err);
      self._changeStatus('failed');
      self.emit('error', err);
      return;
    }

    var contentLength = parseInt(headers['ContentLength']);
    self.prog.total = contentLength;
    //console.log('got content length:', contentLength)
    //空文件
    if(self.prog.total==0){

      fs.writeFile(self.to.path,'', function(err){
        if(err){
          console.log('failed to open local file');
          self._changeStatus('failed');
          self.emit('error', err);
        }
        else{
          self._changeStatus('finished');
          self.emit('progress', {total:0, loaded:0});
          self.emit('partcomplete', {total:0, done:0});
          self.emit('complete');
        }
      });
      return;
    }


    if(self.stopFlag){
      return;
    }

    chunkSize = checkPoints.chunkSize || self._config.chunkSize || util.getSensibleChunkSize(self.prog.total);

    //console.log('chunkSize:',chunkSize);

    chunkNum = Math.ceil(self.prog.total / chunkSize);

    chunks = [];
    for (var i = 0; i < chunkNum; i++) {

      if(!checkPoints.Parts[i+1] || !checkPoints.Parts[i+1].done){
        chunks.push(i);
        checkPoints.Parts[i+1] = {
          PartNumber: i+1,
          loaded: 0,
          done: false
        };
      }

    }

    completedCount = chunkNum - chunks.length;


    if(chunks.length==0) {
      //done

     for(var k in checkPoints.Parts) {
       self.prog.loaded += checkPoints.Parts[k].loaded;
     }

      var progCp = JSON.parse(JSON.stringify(self.prog));
      self._changeStatus('finished');
      self.emit('progress', progCp);
      self.emit('partcomplete', {total:chunkNum, done:chunkNum});
      self.emit('complete');
      return;

    }

    //downloadPart(getNextPart());
    createFileIfNotExists(tmpName, (err)=>{
      if (err) {
        console.error('failed to open local file');
        self._changeStatus('failed');
        self.emit('error', err);
        return;
      }


      if (self.stopFlag) {
        //util.closeFD(fd);
        return;
      }

      //util.closeFD(fd);
      downloadPart(getNextPart());
    });

  });

  function createFileIfNotExists(p, fn){
    try{
      fs.statSync(p);
      fn();
    }catch(e){
      fs.writeFile(tmpName, '',fn);
    }
  }


  function downloadPart(n) {

    var start = chunkSize * n;
    var end = (n + 1 < chunkNum) ? start + chunkSize : self.prog.total;

    var partNumber = n+1;

    //checkPoints.Parts[partNumber] = {
    //  PartNumber: partNumber,
    //  loaded: 0,
    //  done: false
    //};

    var retryCount = 0;


    var obj = JSON.parse(JSON.stringify(objOpt));

    obj.Range = `bytes=${start}-${end-1}`;

    //console.log(obj.Range);


    concurrency++;
    doDownload(n);


    if (hasNextPart() && concurrency < maxConcurrency) {
      concurrency++;
      downloadPart(getNextPart());
    }


    function doDownload(n) {
      if(n==null)return;

      if(self.stopFlag){
        //util.closeFD(keepFd);
        return;
      }

      var req = self.oss.getObject(obj, (err, data) => {

        if (err) {
          if(err.code=='RequestAbortedError'){
            //用户取消
            console.warn('用户取消');
            return;
          }
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`retry download part [${n}] error:${err}`);
            checkPoints.Parts[partNumber].loaded = 0;
            doDownload(n);
          }
          else {
            self._changeStatus('failed');
            console.log(`failed to download part [${n}]`);
            self.emit('error', err);
            //util.closeFD(keepFd);
          }
          return;
        }


        if(self.stopFlag){
          //util.closeFD(keepFd);
          return;
        }

        //console.log(0, end - start, start, end);
        writeFileRange(tmpName, data.Body, start, function(err){

          if (err) {
            console.log('failed to write local file');
            self._changeStatus('failed');
            self.emit('error', err);
            //util.closeFD(keepFd);
            return;
          }

          completedCount++;
          concurrency--;

          completedBytes+= (end-start);

          //self.prog.loaded += (end-start);

          checkPoints.Parts[partNumber].done=true;

          //var progCp = JSON.parse(JSON.stringify(self.prog));

          //console.log(`complete part [${n}]`);


          if (completedCount == chunkNum) {

            //util.closeFD(keepFd);
            fs.renameSync(tmpName,  self.to.path);
            self._changeStatus('finished');
            //self.emit('progress', progCp);
            self.emit('partcomplete', {total:chunkNum, done:completedCount}, checkPoints);
            self.emit('complete');
          }
          else {
            //self.emit('progress', progCp);
            self.emit('partcomplete', {total:chunkNum, done:completedCount}, checkPoints);
            downloadPart(getNextPart());
          }
        });
      });


      //fix abort: _abortCallback is not a function
      req.httpRequest._abortCallback = function(){};


      req.on('httpDownloadProgress', function (p) {

        if(self.stopFlag){
          try {
            req.abort();
          } catch (e) {
            console.log(e.stack);
          }
          checkPoints.Parts[partNumber].loaded = 0;
          checkPoints.Parts[partNumber].done=false;
          return;
        }

        checkPoints.Parts[partNumber].loaded = p.loaded;

        var loaded = 0;
        for (var k in checkPoints.Parts) {
          loaded += checkPoints.Parts[k].loaded;
        }

        self.prog.loaded = loaded;
        self.emit('progress',  self.prog);

      });
    }
  }

  function getNextPart() {
    return chunks.shift();
  }

  function hasNextPart() {
    return chunks.length > 0;
  }

  function writeFileRange(tmpName, data, start, fn){
    var file = fs.createWriteStream(tmpName,{ start: start , flags:'r+'});
    file.end(data);
    file.on('error', (err)=>{ fn(err); });
    file.on('finish', ()=>{ fn(null); });
  }
};



module.exports = DownloadJob;
