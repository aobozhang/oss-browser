angular.module('web')
  .controller('getAddressModalCtrl', ['$scope', '$q', '$uibModalInstance', 'item','settingsSvs', 'currentInfo', 'ossSvs','safeApply',
    function ($scope, $q, $modalInstance, item, settingsSvs, currentInfo, ossSvs ,safeApply) {

    var Url = require('url');

      angular.extend($scope, {
        item: item,
        currentInfo: currentInfo,
        info: {
          sec: 3600,
          url: null
        },
        cancel: cancel,
        onSubmit: onSubmit
      });

      function cancel() {
        $modalInstance.dismiss('close');
      }

      init();
      function init(){
        $scope.isLoading = true;
        $scope.step=2;
        $scope.cdnUrl='';
        var ignoreError = true;

        $.ajax({url: item.url,
          headers: {'Range':'bytes=0-1','x-random':Math.random()},
          complete: function(xhr){
            $scope.isLoading = false;
            if(xhr.status < 300){
              $scope.err = null;
              //by Aobo： 如果设置类 cdn host，则增加cdn地址显示；
              if(settingsSvs.cdnUrlHost.get() != ""){
                  var oriUrl = Url.parse(item.url);
                  var cdnSetting = JSON.parse(settingsSvs.cdnUrlHost.get(), function(k, v) {
                      var isMatch = oriUrl.host.indexOf(k) >= 0; //检查是否有符合设置的Bucket；
                      if(k && isMatch) {
                          oriUrl.host = v;
                          $scope.cdnUrl = Url.format(oriUrl);
                      }
                  });
              }

              $scope.step=1;
            }
            else if(xhr.status==403){
              $scope.step = 2;
            }
            else{
              $scope.step = 3;
            }
            safeApply($scope);
          }
        });

      }

      function onSubmit(form1){
        if(!form1.$valid)return;

        var v = $scope.info.sec;
        var url = ossSvs.signatureUrl(currentInfo.region, currentInfo.bucket, item.path, v);
        $scope.info.url = url;
      }

    }
  ]);
