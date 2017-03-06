'use strict';

angular.module('web')
  .controller('settingsCtrl', ['$scope','$state','$uibModalInstance','settingsSvs','Toast',
  function($scope,$state,$modalInstance,settingsSvs,Toast){

    angular.extend($scope, {
      showTab: 3,
      set: {
        cdnUrlHost: settingsSvs.cdnUrlHost.get(),
        maxUploadJobCount: settingsSvs.maxUploadJobCount.get(),
        maxDownloadJobCount: settingsSvs.maxDownloadJobCount.get(),
        historiesLength : settingsSvs.historiesLength.get(),
      },
      onSubmit:onSubmit,
      cancel: cancel
    });

    function onSubmit(form1){
      if(!form1.$valid)return;

      settingsSvs.cdnUrlHost.set( $scope.set.cdnUrlHost );
      settingsSvs.maxUploadJobCount.set( $scope.set.maxUploadJobCount );
      settingsSvs.maxDownloadJobCount.set( $scope.set.maxDownloadJobCount );
      settingsSvs.historiesLength.set( $scope.set.historiesLength );

      Toast.success('保存成功');
       cancel();
    }

    function cancel(){
      $modalInstance.dismiss('close');
    }

  }])
;
