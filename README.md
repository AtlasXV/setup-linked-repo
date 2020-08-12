# setup-linked-repo
用于获取并设置当前项目的关联项目token,以便用于代码的检出操作，比如在iOS项目中检出Match库，或者拉取私有的library.
当在组织内使用时，只需配置
```yml
- name: link match repo
  uses: AtlasXV/setup-linked-repo@v1
  with:
    # 设置关联项目token授权节点地址,组织内永远为 CI_TOKEN_GRANT_ENDPOINT
    grant_endpoint: ${{ secrets.CI_TOKEN_GRANT_ENDPOINT }}
    # 设置关联的项目，这里示意为match仓库，需要对match仓库进行授权设置后方可使用
    linked_repository: AtlasXV/certificates                  
```
使用需要注意两点：
1. 需要提前对关联仓库进行授权设置，授权方法为，将`组织名_仓库名`(仓库名中如果存在-请替换为_)设置到关联仓库的secrets的name中，value随意。例如要为AtlasXV/SpeedTest_iOS项目在AtlasXV/certificates创建关联，那么需要在AtlasXV/certificates的secrets中新建一个变量名为AtlasXV_SpeedTest_iOS，变量内容随意，则完成关联授权。
2. 如果需要在组织外使用，则需要自己实现CI_TOKEN_GRANT_ENDPOINT中的逻辑，action回向`CI_TOKEN_GRANT_ENDPOINT/org/reponame`发送一个post请求，请求头为当前项目的token，请求体为json格式，分别为owner和repo两个参数，代表取得对应的关联repo的组织和name，实现的逻辑为首先验证当前项目的token和名字是否可以对应，对应后实现自己的项目关联逻辑，判断两个项目是否有关联，有则返回新项目的token，无则不返回。


