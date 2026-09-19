; 自定义 NSIS 脚本（electron-builder 默认会 include build/installer.nsh）
;
; 背景：应用默认把 ComfyUI 运行环境放在安装目录下的 ComfyUI-Runtime（ComfyUI 本体、venv、
; 模型、工作流，动辄几十 GB）。electron-builder 生成的卸载器是 RMDir /r "$INSTDIR" 整目录递归
; 删除，而升级 / 重装时安装程序会先以 --updated 调用旧卸载器，于是升级同样会把运行环境删掉。
;
; 行为：
;   · 升级 / 重装：不弹窗，始终保留 ComfyUI-Runtime（弹窗会阻塞静默升级）
;   · 主动卸载：欢迎页之后多一页「卸载选项」，让用户选择保留还是删除（不再是裸 MessageBox）
;   · 静默卸载（/S）：不弹窗，按「保留」处理（删除不可逆，保留可事后手动清理）
;
; 注意 1：electron-builder 会编译两趟——先以 BUILD_UNINSTALLER 编译出独立卸载器，最终安装包那一趟
; 只是把卸载器 exe 当普通文件嵌进去（没有 WriteUninstaller）。所以本文件必须整体限定在
; BUILD_UNINSTALLER 这一趟，否则最终趟会因为「有 un. 代码却没有 WriteUninstaller」触发
; warning 6020，而默认 warningsAsErrors=true 会让打包直接失败。
;
; 注意 2：本文件在 installer.nsi 之前被 include，而 MUI2.nsh 是 installer.nsi 里才引入的。
; !macro 体内的代码在「插入」时才展开（那时 MUI2 已就绪），顶层 Function 体却会立刻编译——
; 所以自定义页的页面函数写在宏里插入，${If} / ${NSD_*} / MUI_HEADER_TEXT 才能解析到。
;
; 注意 3：默认逻辑在升级时会先把安装目录下的文件原子重命名到 $PLUGINSDIR\old-install，
; 以便更新失败时回滚。这里为了不搬运运行环境而绕过了它，代价是更新中途失败不再自动回滚
; （安装程序在删除前已结束残留进程，实际风险很低）。

!ifdef BUILD_UNINSTALLER

; nsDialogs 用于自定义页，自带 LogicLib（顶层页面函数要用 ${If} / ${NSD_*} 必须先引入）
!include nsDialogs.nsh

; 卸载时用户的选择："0" = 连同运行环境一起删除；其他值（默认空串）一律保留
Var /GLOBAL keepRuntimeOnUninstall
; 「卸载选项」页的单选按钮
Var /GLOBAL unOptKeepRadio
Var /GLOBAL unOptDeleteRadio

!macro customUnWelcomePage

  ; 默认欢迎页（带生成的卸载侧边大图，含 MUI_UNPAGE_INIT 的界面初始化）
  !insertmacro MUI_UNPAGE_WELCOME

  ; 自定义页同样需要 MUI 的页面初始化，否则 MUI_HEADER_TEXT 取不到 $mui.Header.*
  !insertmacro MUI_UNPAGE_INIT

  Function un.unOptionsPageCreate
    ; 静默卸载（/S）、升级（--updated）、安装目录未知：都不弹页，按「保留」处理
    ${If} ${Silent}
      Abort
    ${EndIf}
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} $INSTDIR == ""
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "卸载选项" "选择是否保留 ComfyUI 运行环境"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ; 说明性文字只放在「分组框标题 + 底部提示」：实测分组框内靠上的静态标签画不出来
    ; （与文案无关，纯字面量同样不显示），因此不往封面区域塞额外标签
    ${NSD_CreateGroupBox} 0 0 100% 96u "ComfyUI 运行环境（ComfyUI-Runtime）"
    Pop $0
    ${NSD_CreateRadioButton} 8u 48u -16u 14u "保留（推荐）：重装后可直接继续使用，不必重新下载模型"
    Pop $unOptKeepRadio
    ${NSD_CreateRadioButton} 8u 66u -16u 14u "一并删除：连运行环境一起删除，模型与工作流将无法恢复"
    Pop $unOptDeleteRadio
    ${NSD_CreateLabel} 8u 82u -16u 12u "含本体、虚拟环境、模型与工作流，通常数十 GB；默认保留。"
    Pop $0

    ${NSD_Check} $unOptKeepRadio
    nsDialogs::Show
  FunctionEnd

  Function un.unOptionsPageLeave
    ; 只有选中「一并删除」才置 "0"；其余情况保持默认空值（保留）
    ${NSD_GetState} $unOptDeleteRadio $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $keepRuntimeOnUninstall "0"
    ${EndIf}
  FunctionEnd

  UninstPage custom un.unOptionsPageCreate un.unOptionsPageLeave

!macroend

!macro customUnInstall
  ; 选了「一并删除」再确认一次：几十 GB 的模型删掉无法恢复，默认按钮给「否」
  ${If} $keepRuntimeOnUninstall == "0"
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "确认连同 ComfyUI 运行环境一起删除？$\r$\n$\r$\n$INSTDIR\ComfyUI-Runtime$\r$\n其中的模型与工作流将无法恢复。$\r$\n$\r$\nDelete the ComfyUI runtime folder as well? This cannot be undone." /SD IDNO IDYES deleteRuntimeConfirmed
    StrCpy $keepRuntimeOnUninstall "1"
    deleteRuntimeConfirmed:
  ${EndIf}
!macroend

!macro customRemoveFiles
  ; $INSTDIR 来自注册表，异常时可能为空；递归删除靠它拼路径（空路径会枚举到盘根目录），必须先挡住
  ${if} $INSTDIR == ""
    DetailPrint "Install path is unknown, skip file removal"
  ${else}
    ; 当前目录不能停在待删目录里，否则删除会失败
    SetOutPath $TEMP
    ${if} ${isUpdated}
      Push ""
      Call un.removeAllExceptRuntime
      Pop $R0
    ${else}
      ; 只有用户明确选择「删除」时才整目录删；其余情况（含变量未设置）都保留运行环境
      ${if} $keepRuntimeOnUninstall == "0"
        RMDir /r $INSTDIR
        Goto removeFilesDone
      ${else}
        Push ""
        Call un.removeAllExceptRuntime
        Pop $R0
      ${endif}
    ${endif}
    ; 保留了运行环境时目录非空、这行会失败；什么都没保留时顺手把空目录清掉
    RMDir "$INSTDIR"
    removeFilesDone:
  ${endif}
!macroend

; 递归删除 $INSTDIR 下除 ComfyUI-Runtime 之外的全部内容
; 入参 / 出参：栈顶为相对 $INSTDIR 的路径（"" 表示安装目录根）
Function un.removeAllExceptRuntime
  Exch $R0
  Push $R1
  Push $R2
  Push $R3

  StrCpy $R3 "$INSTDIR$R0\*.*"
  FindFirst $R1 $R2 $R3

  loop:
    StrCmp $R2 "" break
    StrCmp $R2 "." continue
    StrCmp $R2 ".." continue

    ; 只在安装目录根层跳过运行环境目录
    StrCmp $R0 "" 0 notKeep
      StrCmp $R2 "ComfyUI-Runtime" continue
    notKeep:

    IfFileExists "$INSTDIR$R0\$R2\*.*" isDir isNotDir

    isDir:
      Push "$R0\$R2"
      Call un.removeAllExceptRuntime
      Pop $R3
      ; 子目录内容删空后自删；非空会失败，正是期望的保守行为
      RMDir "$INSTDIR$R0\$R2"
      Goto continue

    isNotDir:
      Delete "$INSTDIR$R0\$R2"
      Goto continue

  continue:
    FindNext $R1 $R2
    Goto loop

  break:
    FindClose $R1
    StrCpy $R0 0
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

!endif
