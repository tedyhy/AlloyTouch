/* AlloyTouch v0.2.3
 * By AlloyTeam http://www.alloyteam.com/
 * Github: https://github.com/AlloyTeam/AlloyTouch
 * Wiki: https://github.com/AlloyTeam/AlloyTouch/wiki
 * MIT Licensed.
 */

;
(function() {
    'use strict';

    /**
     * 兼容各个浏览器的 requestAnimationFrame 和 cancelAnimationFrame，
     * 利用 setTimeout 来兼容不支持 requestAnimationFrame 的浏览器。
     */

    if (!Date.now)
        Date.now = function() {
            return new Date().getTime();
        };

    var vendors = ['webkit', 'moz'];
    for (var i = 0; i < vendors.length && !window.requestAnimationFrame; ++i) {
        var vp = vendors[i];
        window.requestAnimationFrame = window[vp + 'RequestAnimationFrame'];
        window.cancelAnimationFrame = (window[vp + 'CancelAnimationFrame'] || window[vp + 'CancelRequestAnimationFrame']);
    }

    // iOS6 有bug
    if (/iP(ad|hone|od).*OS 6/.test(window.navigator.userAgent) // iOS6 is buggy
        || !window.requestAnimationFrame || !window.cancelAnimationFrame) {
        var lastTime = 0;
        window.requestAnimationFrame = function(callback) {
            var now = Date.now();
            // 很巧妙，第一次时，nextTime - now === 0，callback 立即执行，之后每隔 16ms 频率执行。
            var nextTime = Math.max(lastTime + 16, now);
            return setTimeout(function() {
                    callback(lastTime = nextTime);
                },
                nextTime - now);
        };
        window.cancelAnimationFrame = clearTimeout;
    }
}());

(function() {

    // 封装绑定事件函数
    function bind(element, type, callback) {
        element.addEventListener(type, callback, false);
    }

    // 运动使用的缓动函数，根据 x 求 y。一个先加速再减速的过程，用来模拟摩擦力非常合适，当然回弹也是用的这段缓动。
    function ease(x) {
        return Math.sqrt(1 - Math.pow(x - 1, 2));
    }

    // 逆向缓动，根据 y 的值求 x。和上面的缓动函数相反。
    // 这个函数主要用于当运动超出 min 和 max 边界不能完整完成一次运动过程的时候求出其中不完整的路程的消耗的时间。
    function reverseEase(y) {
        return 1 - Math.sqrt(1 - y * y);
    }

    // 阻止默认也有例外，如：{ tagName: /^(INPUT|TEXTAREA|BUTTON|SELECT)$/ }
    // 检测 INPUT|TEXTAREA|BUTTON|SELECT 标签，如果是这些标签将不会去阻止默认事件。
    function preventDefaultTest(el, exceptions) {
        for (var i in exceptions) {
            if (exceptions[i].test(el[i])) {
                return true;
            }
        }
        return false;
    }

    var AlloyTouch = function(option) {
        // 指定用户触摸的 DOM 元素，即：option.touch【必选】
        this.element = typeof option.touch === "string" ? document.querySelector(option.touch) : option.touch;
        // 指定反馈触摸进行运动的 DOM 元素，默认是 this.element【可选】
        this.target = this._getValue(option.target, this.element);
        // 指定监听用户垂直方向上的触摸还是水平方向上的触摸，默认监听垂直方向上的【可选】
        this.vertical = this._getValue(option.vertical, true);
        // 指定被运动的 CSS3 属性【必选】
        this.property = option.property;
        // 帧 ID
        this.tickID = 0;

        // 被运动的 CSS3 属性初始化值【可选】
        this.initialValue = this._getValue(option.initialValue, this.target[this.property]);
        // 对 DOM 元素设置初始化值
        this.target[this.property] = this.initialValue;
        // 是否锁定 DOM CSS3 属性值，不发生改变，默认false【可选】
        this.fixed = this._getValue(option.fixed, false);
        // 触摸区域的灵敏度，默认值为1，可以为负数【可选】
        // 灵敏度，类似鼠标灵敏度的概念。就是你移动10CM，光标也移动10CM?或者20CM?都可以通过灵敏度配出来~~
        this.sensitivity = this._getValue(option.sensitivity, 1);
        // touchmove 时候的摩擦系数【可选】
        this.moveFactor = this._getValue(option.moveFactor, 1);
        // 表示触摸位移与被运动属性映射关系，默认值是1【可选】
        this.factor = this._getValue(option.factor, 1);
        this.outFactor = this._getValue(option.outFactor, 0.3);
        // 可以这样设置：min:250-2000, max:0
        // 最小值，超出会回弹【必选】
        this.min = option.min;
        // 最大值，超出会回弹【必选】
        this.max = option.max;
        // 加速度系数
        this.deceleration = 0.0006;
        // 惯性运动超出边界的最大值，默认是60【可选】
        this.maxRegion = this._getValue(option.maxRegion, 600);
        this.springMaxRegion = this._getValue(option.springMaxRegion, 60);
        // 最大速度【可选】
        this.maxSpeed = option.maxSpeed;
        // 是否有最大速度
        this.hasMaxSpeed = !(this.maxSpeed === void 0);
        // 锁定方向，默认锁定【可选】
        this.lockDirection = this._getValue(option.lockDirection, true);

        // 一些回调
        var noop = function() {};
        this.change = option.change || noop; // 属性改变的回调。alloytouch.css 版本不支持该事件【可选】
        this.touchEnd = option.touchEnd || noop; // touchend 事件回调
        this.touchStart = option.touchStart || noop; // touchstart 事件回调
        this.touchMove = option.touchMove || noop; // touchmove 事件回调
        this.touchCancel = option.touchCancel || noop; // touchcancel 事件回调
        this.reboundEnd = option.reboundEnd || noop; // 反弹结束后回调
        this.animationEnd = option.animationEnd || noop; // 动画结束后回调
        this.correctionEnd = option.correctionEnd || noop; // 更正结束后回调
        this.tap = option.tap || noop; // tap 回调
        // touchmove 回调
        this.pressMove = option.pressMove || noop;

        // 是否阻止默认，默认true【可选】
        this.preventDefault = this._getValue(option.preventDefault, true);
        // 禁止阻止默认的 DOM
        this.preventDefaultException = {
            tagName: /^(INPUT|TEXTAREA|BUTTON|SELECT)$/
        };
        // 是否有最小值
        this.hasMin = !(this.min === void 0);
        // 是否有最大值
        this.hasMax = !(this.max === void 0);
        // 判断 min 和 max 值大小，如果最小值大于最大值则抛出错误
        if (this.hasMin && this.hasMax && this.min > this.max) {
            throw "the min value can't be greater than the max value."
        }
        // 记录是否开始 touchStart，第一次为 false
        this.isTouchStart = false;
        // 每页长度
        this.step = option.step;
        // 是否有 step
        this.hasStep = !(this.step === void 0);
        // 是否有惯性，默认有【可选】
        this.inertia = this._getValue(option.inertia, true);

        // 计算当前页面所在索引值 this.currentPage
        this.currentPage = 0;
        this._calculateIndex();

        // 事件绑定到哪里，默认为window
        this.eventTarget = window;
        // 将事件绑定到自身【可选】
        if (option.bindSelf) {
            this.eventTarget = this.element;
        }

        // 使用 bind 将事件回调绑定到 this.eventTarget 上
        bind(this.element, "touchstart", this._start.bind(this));
        bind(this.eventTarget, "touchend", this._end.bind(this));
        bind(this.eventTarget, "touchcancel", this._cancel.bind(this));
        this.eventTarget.addEventListener("touchmove", this._move.bind(this), {
            // 这里禁用改善滚屏性能
            // 浏览器页面的滑动流畅度相对使用之前提升了很多，chrome51+ 开始使用
            passive: false,
            capture: false // 禁止事件捕获
        });
        // 初始化坐标
        this.x1 = this.x2 = this.y1 = this.y2 = null;
    };

    AlloyTouch.prototype = {
        // 如果 obj 未定义，则使用默认值 defaultValue
        _getValue: function(obj, defaultValue) {
            return obj === void 0 ? defaultValue : obj;
        },
        _start: function(evt) {
            this.isTouchStart = true; // 记录开始 touch
            this.touchStart.call(this, evt, this.target[this.property]); // 执行 touchstart 回调
            cancelAnimationFrame(this.tickID); // 清除之前帧 ID
            this._calculateIndex(); // 计算当前在第几页（索引）
            this.startTime = new Date().getTime(); // 记录开始时间
            this.x1 = this.preX = evt.touches[0].pageX; // 记录 DOM 元素基于页面的 X 坐标
            this.y1 = this.preY = evt.touches[0].pageY; // 记录 DOM 元素基于页面的 Y 坐标
            this.start = this.vertical ? this.preY : this.preX; // 开始位置，判断是否是只监听垂直方向
            this._firstTouchMove = true; // 是否是第一次 touchmove
            this._preventMove = false; // 是否要阻止 touchmove
        },
        _move: function(evt) {
            // touchstart 后才能执行
            if (!this.isTouchStart) return;

            var len = evt.touches.length,
                currentX = evt.touches[0].pageX,
                currentY = evt.touches[0].pageY;

            if (this._firstTouchMove && this.lockDirection) {
                var dDis = Math.abs(currentX - this.x1) - Math.abs(currentY - this.y1);
                if (dDis > 0 && this.vertical) {
                    this._preventMove = true;
                } else if (dDis < 0 && !this.vertical) {
                    this._preventMove = true;
                }
                this._firstTouchMove = false;
            }
            if (!this._preventMove) {
                var d = (this.vertical ? currentY - this.preY : currentX - this.preX) * this.sensitivity;
                var f = this.moveFactor;
                if (this.hasMax && this.target[this.property] > this.max && d > 0) {
                    f = this.outFactor;
                } else if (this.hasMin && this.target[this.property] < this.min && d < 0) {
                    f = this.outFactor;
                }
                d *= f;
                this.preX = currentX;
                this.preY = currentY;
                if (!this.fixed) {
                    this.target[this.property] += d;
                }
                this.change.call(this, this.target[this.property]);
                var timestamp = new Date().getTime();
                if (timestamp - this.startTime > 300) {
                    this.startTime = timestamp;
                    this.start = this.vertical ? this.preY : this.preX;
                }
                this.touchMove.call(this, evt, this.target[this.property]);
            }

            if (this.preventDefault && !preventDefaultTest(evt.target, this.preventDefaultException)) {
                evt.preventDefault();
            }

            if (len === 1) {
                if (this.x2 !== null) {
                    evt.deltaX = currentX - this.x2;
                    evt.deltaY = currentY - this.y2;

                } else {
                    evt.deltaX = 0;
                    evt.deltaY = 0;
                }
                this.pressMove.call(this, evt, this.target[this.property]);
            }
            this.x2 = currentX;
            this.y2 = currentY;
        },
        _cancel: function(evt) {
            // 当一些更高级别的事件发生的时候（如电话接入或者弹出信息）会取消当前的touch操作，即触发touchcancel。
            // 一般会在touchcancel时暂停游戏、存档等操作。
            // 获取当前属性值并传给 touchcancel 事件回调。
            var current = this.target[this.property];
            this.touchCancel.call(this, evt, current);
            // 调用 touchend 事件回调结束 touch 跟踪
            this._end(evt);
        },
        // 对外供调用 API，结合 example/carousel.html 理解
        // v 为要赋的属性值。time 动画间隔，默认 600ms。user_ease 指定动画，默认 ease 函数。
        to: function(v, time, user_ease) {
            this._to(v, this._getValue(time, 600), user_ease || ease, this.change, function(value) {
                this._calculateIndex(); // 更新页面索引值
                this.reboundEnd.call(this, value); // 反弹回调
                this.animationEnd.call(this, value); // 动画结束回调
            }.bind(this));
        },
        // 计算当前所在页的索引
        _calculateIndex: function() {
            // 如果有最小值最大值和 step，则通过它们计算当前滚动到了第几页，step 是每页长度
            if (this.hasMax && this.hasMin && this.hasStep) {
                this.currentPage = Math.round((this.max - this.target[this.property]) / this.step);
            }
        },
        _end: function(evt) {
            if (!this.isTouchStart) return;

            this.isTouchStart = false;
            var self = this,
                current = this.target[this.property],
                triggerTap = (Math.abs(evt.changedTouches[0].pageX - this.x1) < 30 && Math.abs(evt.changedTouches[0].pageY - this.y1) < 30);
            if (triggerTap) {
                this.tap.call(this, evt, current);
            }
            if (this.touchEnd.call(this, evt, current, this.currentPage) === false) return;
            if (this.hasMax && current > this.max) {
                this._to(this.max, 200, ease, this.change, function(value) {
                    this.reboundEnd.call(this, value);
                    this.animationEnd.call(this, value);
                }.bind(this));
            } else if (this.hasMin && current < this.min) {
                this._to(this.min, 200, ease, this.change, function(value) {
                    this.reboundEnd.call(this, value);
                    this.animationEnd.call(this, value);
                }.bind(this));
            } else if (this.inertia && !triggerTap && !this._preventMove) {
                var dt = new Date().getTime() - this.startTime;
                if (dt < 300) {
                    var distance = ((this.vertical ? evt.changedTouches[0].pageY : evt.changedTouches[0].pageX) - this.start) * this.sensitivity,
                        speed = Math.abs(distance) / dt,
                        speed2 = this.factor * speed;
                    if (this.hasMaxSpeed && speed2 > this.maxSpeed) {
                        speed2 = this.maxSpeed;
                    }
                    var destination = current + (speed2 * speed2) / (2 * this.deceleration) * (distance < 0 ? -1 : 1);

                    var tRatio = 1;
                    if (destination < this.min) {
                        if (destination < this.min - this.maxRegion) {
                            tRatio = reverseEase((current - this.min + this.springMaxRegion) / (current - destination));
                            destination = this.min - this.springMaxRegion;
                        } else {
                            tRatio = reverseEase((current - this.min + this.springMaxRegion * (this.min - destination) / this.maxRegion) / (current - destination));
                            destination = this.min - this.springMaxRegion * (this.min - destination) / this.maxRegion;
                        }
                    } else if (destination > this.max) {
                        if (destination > this.max + this.maxRegion) {
                            tRatio = reverseEase((this.max + this.springMaxRegion - current) / (destination - current));
                            destination = this.max + this.springMaxRegion;
                        } else {
                            tRatio = reverseEase((this.max + this.springMaxRegion * (destination - this.max) / this.maxRegion - current) / (destination - current));
                            destination = this.max + this.springMaxRegion * (destination - this.max) / this.maxRegion;
                        }
                    }
                    var duration = Math.round(speed / self.deceleration) * tRatio;

                    self._to(Math.round(destination), duration, ease, self.change, function(value) {
                        if (self.hasMax && self.target[self.property] > self.max) {
                            cancelAnimationFrame(self.tickID);
                            self._to(self.max, 600, ease, self.change, self.animationEnd);
                        } else if (self.hasMin && self.target[self.property] < self.min) {
                            cancelAnimationFrame(self.tickID);
                            self._to(self.min, 600, ease, self.change, self.animationEnd);
                        } else {
                            if (self.step) {
                                self._correction()
                            } else {
                                self.animationEnd.call(self, value);
                            }
                        }

                        self.change.call(this, value);
                    });
                } else {
                    self._correction();
                }
            } else {
                self._correction();
            }
            this.x1 = this.x2 = this.y1 = this.y2 = null;
        },
        // 对外供 to 的内部代理函数
        _to: function(value, time, ease, onChange, onEnd) {
            if (this.fixed) return; // 如果锁定 DOM CSS3 属性值，不发生改变

            var el = this.target, // 要运动的元素
                property = this.property; // 要变化的 CSS3 属性
            var current = el[property]; // 当前运动的元素的属性值
            var dv = value - current; // 传参值与当前值差
            var beginTime = new Date();
            var self = this;
            // 生成帧动画
            var toTick = function() {
                var dt = new Date() - beginTime;
                // 如果 toTick 执行间隔时间大于指定的动画过渡间隔时间就立即执行属性赋值操作
                if (dt >= time) {
                    el[property] = value;
                    // 触发属性变化回调
                    onChange && onChange.call(self, value);
                    // 触发传参回调，里面包括：计算当前页面索引值、执行反弹回调、执行动画结束回调
                    onEnd && onEnd.call(self, value);
                    return;
                }
                // 否则，调用动画函数 ease 根据值差生成阶梯差值赋予运动元素属性
                el[property] = dv * ease(dt / time) + current;
                // 记录帧 ID
                self.tickID = requestAnimationFrame(toTick);
                // cancelAnimationFrame 必须在 tickID = requestAnimationFrame(toTick); 的后面执行
                // 触发属性变化回调
                onChange && onChange.call(self, el[property]);
            };
            toTick();
        },
        _correction: function() {
            if (this.step === void 0) return;
            var el = this.target,
                property = this.property;
            var value = el[property];
            var rpt = Math.floor(Math.abs(value / this.step));
            var dy = value % this.step;
            if (Math.abs(dy) > this.step / 2) {
                this._to((value < 0 ? -1 : 1) * (rpt + 1) * this.step, 400, ease, this.change, function(value) {
                    this._calculateIndex();
                    this.correctionEnd.call(this, value);
                    this.animationEnd.call(this, value);
                }.bind(this));
            } else {
                this._to((value < 0 ? -1 : 1) * rpt * this.step, 400, ease, this.change, function(value) {
                    this._calculateIndex();
                    this.correctionEnd.call(this, value);
                    this.animationEnd.call(this, value);
                }.bind(this));
            }
        }
    };

    // module化
    if (typeof module !== 'undefined' && typeof exports === 'object') {
        module.exports = AlloyTouch;
    } else {
        window.AlloyTouch = AlloyTouch;
    }

})();